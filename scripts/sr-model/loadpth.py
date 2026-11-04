"""Reads a PyTorch zip checkpoint (tensors only) into numpy arrays without torch.

Safe loader: the unpickler only resolves the three names a plain state dict needs and refuses
every other global, so no code from the file can run (same idea as torch.load(weights_only=True)).
"""
import collections
import pickle
import zipfile

import numpy as np

DT = {'FloatStorage': np.float32, 'HalfStorage': np.float16, 'DoubleStorage': np.float64, 'LongStorage': np.int64}


def load(path):
    z = zipfile.ZipFile(path)
    prefix = z.namelist()[0].split('/')[0]

    def rebuild(storage, offset, size, stride, *_):
        dtype, key = storage
        raw = np.frombuffer(z.read(f'{prefix}/data/{key}'), dtype=dtype)
        if not size:
            return raw[offset:offset + 1].reshape(())
        return np.lib.stride_tricks.as_strided(raw[offset:], shape=size, strides=[s * raw.itemsize for s in stride]).copy()

    class Strict(pickle.Unpickler):
        def find_class(self, mod, name):
            if (mod, name) == ('torch._utils', '_rebuild_tensor_v2'):
                return rebuild
            if (mod, name) == ('collections', 'OrderedDict'):
                return collections.OrderedDict
            if mod == 'torch' and name in DT:
                return name
            raise pickle.UnpicklingError(f'refused global {mod}.{name}')

        def persistent_load(self, pid):
            # ('storage', storage_type, key, location, numel)
            if not (isinstance(pid, tuple) and pid[0] == 'storage' and pid[1] in DT):
                raise pickle.UnpicklingError(f'unexpected persistent id {pid!r}')
            return (DT[pid[1]], str(pid[2]))

    return Strict(z.open(f'{prefix}/data.pkl')).load()
