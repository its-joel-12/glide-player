"""Converts Real-ESRGAN realesr-general-x4v3 (SRVGGNetCompact, BSD-3) to a fixed-size TFLite model.

Input  [1, T, T, 3] float32 RGB 0..1 (NHWC), output [1, 4T, 4T, 3] float32 (not clamped).
Weights are stored as float16. Checks the TFLite model against a numpy re-implementation of
the original PyTorch forward pass (NCHW, PixelShuffle ordering).
"""
import os
import sys

import numpy as np
import tensorflow as tf

sys.path.insert(0, os.path.dirname(__file__))
from loadpth import load  # noqa: E402

T = int(os.environ.get('TILE', '192'))
SRC = sys.argv[1]
DST = sys.argv[2]

p = load(SRC)['params']
convs = sorted({int(k.split('.')[1]) for k in p if k.endswith('.bias')})
prelus = sorted({int(k.split('.')[1]) for k in p if k.endswith('.weight') and p[k].ndim == 1})
print('convs', len(convs), 'prelus', len(prelus))
R = 4

# ---- numpy reference (PyTorch semantics) ----
def conv_nchw(x, w, b):
    c, h, wd = x.shape
    xp = np.pad(x, ((0, 0), (1, 1), (1, 1)))
    out = np.zeros((w.shape[0], h, wd), np.float64)
    for dy in range(3):
        for dx in range(3):
            out += np.einsum('oc,chw->ohw', w[:, :, dy, dx], xp[:, dy:dy + h, dx:dx + wd])
    return out + b[:, None, None]


def reference(x_hwc):
    x = x_hwc.transpose(2, 0, 1).astype(np.float64)
    out = x
    for idx in range(max(convs) + 1):
        if idx in convs:
            out = conv_nchw(out, p[f'body.{idx}.weight'], p[f'body.{idx}.bias'])
        elif idx in prelus:
            a = p[f'body.{idx}.weight'][:, None, None]
            out = np.where(out >= 0, out, a * out)
    c = out.shape[0] // (R * R)
    h, w = out.shape[1:]
    # PixelShuffle: out[c, h*r+i, w*r+j] = in[c*r*r + i*r + j, h, w]
    ps = out.reshape(c, R, R, h, w).transpose(0, 3, 1, 4, 2).reshape(c, h * R, w * R)
    base = np.repeat(np.repeat(x, R, axis=1), R, axis=2)
    return (ps + base).transpose(1, 2, 0)


# ---- Keras model (NHWC) ----
inp = tf.keras.Input((T, T, 3), batch_size=1, name='rgb')
y = inp
for idx in range(max(convs) + 1):
    if idx in convs:
        w = p[f'body.{idx}.weight']  # [out, in, kh, kw]
        b = p[f'body.{idx}.bias']
        k = w.transpose(2, 3, 1, 0)  # [kh, kw, in, out]
        if idx == max(convs):
            # depth_to_space channel (i*r + j)*C + c  <-  PixelShuffle channel c*r*r + i*r + j
            C = w.shape[0] // (R * R)
            perm = [(kk % C) * R * R + kk // C for kk in range(w.shape[0])]
            k = k[..., perm]
            b = b[perm]
        layer = tf.keras.layers.Conv2D(w.shape[0], 3, padding='same')
        y = layer(y)
        layer.set_weights([k, b])
    elif idx in prelus:
        layer = tf.keras.layers.PReLU(shared_axes=[1, 2])
        y = layer(y)
        layer.set_weights([np.broadcast_to(p[f'body.{idx}.weight'], (1, 1, 64)).copy()])
# Nearest-neighbour base image: R*R copies of the RGB input in depth_to_space order (all GPU-friendly 4D ops).
base = tf.keras.layers.Concatenate(axis=-1)([inp] * (R * R))
y = tf.keras.layers.Add()([y, base])
out = tf.keras.layers.Lambda(lambda t: tf.nn.depth_to_space(t, R), name='sr')(y)
model = tf.keras.Model(inp, out)

conv = tf.lite.TFLiteConverter.from_keras_model(model)
conv.optimizations = [tf.lite.Optimize.DEFAULT]
conv.target_spec.supported_types = [tf.float16]
blob = conv.convert()
open(DST, 'wb').write(blob)
print('tflite bytes', len(blob))

# ---- check ----
rng = np.random.default_rng(1)
img = rng.random((T, T, 3), dtype=np.float32)
# smooth-ish content so the check resembles a real picture
img = (0.6 * img + 0.4 * np.linspace(0, 1, T)[None, :, None]).astype(np.float32)
it = tf.lite.Interpreter(model_path=DST)
it.allocate_tensors()
i0, o0 = it.get_input_details()[0], it.get_output_details()[0]
print('in', i0['shape'], i0['dtype'], 'out', o0['shape'], o0['dtype'])
it.set_tensor(i0['index'], img[None])
it.invoke()
got = it.get_tensor(o0['index'])[0]
ref = reference(img[:48, :48])  # full ref is slow; compare the top-left area away from the tile edge effects
gcrop = got[:48 * R, :48 * R]
# the reference on a 48x48 crop has its own border at 48: compare the inner part only
inner = slice(0, 24 * R)
err = np.abs(gcrop[inner, inner] - ref[inner, inner])
print('max abs err (inner)', float(err.max()), 'mean', float(err.mean()))
km = model.predict(img[None], verbose=0)[0]
print('keras vs tflite max', float(np.abs(km - got).max()))
assert err.max() < 0.02, 'TFLite model does not match the PyTorch reference'
print('OK')
