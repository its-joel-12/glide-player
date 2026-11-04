# AI upscaling model

`modules/glide-engine/android/src/main/assets/glide-sr-x4.tflite` is Real-ESRGAN's
`realesr-general-x4v3` (SRVGGNetCompact, 1.2 M parameters, BSD-3-Clause, see
`glide-sr-x4.LICENSE.txt` next to it) converted to TensorFlow Lite with float16 weights:

- input `[1, 192, 192, 3]` float32, RGB 0..1; output `[1, 768, 768, 3]` float32 (4×, not clamped)
- ops: CONV_2D, PRELU, CONCATENATION, ADD, DEPTH_TO_SPACE (all run on the TFLite GPU delegate)

To rebuild it (needs `pip install tensorflow-cpu numpy`, no PyTorch):

```bash
curl -LO https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth
TILE=192 python3 scripts/sr-model/convert.py realesr-general-x4v3.pth modules/glide-engine/android/src/main/assets/glide-sr-x4.tflite
```

The script reads the checkpoint with a restricted unpickler (tensors only), rebuilds the network in
Keras, converts it, and checks the TFLite output against a numpy version of the original PyTorch
forward pass (it fails if they differ by more than 0.02). If you change `TILE`, change
`NeuralPlan.TILE` (Kotlin) and `NEURAL_TILE` (`src/lib/upscale-plan.ts`) too.
