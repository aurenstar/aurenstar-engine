/**
 * Minimal WASI (preview1) layer for the Swiss Ephemeris WebAssembly build.
 *
 * Cloudflare Workers have no file system, so the ephemeris data files (*.se1) are kept in memory
 * and served to the WebAssembly code through the few WASI calls it uses to open and read files.
 * Files must be loaded into `files` (name -> bytes) BEFORE a calculation runs.
 */
const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_NOENT = 44;
const ERRNO_INVAL = 28;

const PREOPEN_FD = 3;
const FIRST_FILE_FD = 4;

interface OpenFile {
  name: string;
  pos: number;
}

export function createWasiImports(
  getMemory: () => WebAssembly.Memory,
  files: Map<string, Uint8Array>,
  dirName = '/ephe'
) {
  const open = new Map<number, OpenFile>();
  let nextFd = FIRST_FILE_FD;
  const view = () => new DataView(getMemory().buffer);
  const bytes = () => new Uint8Array(getMemory().buffer);
  const decoder = new TextDecoder();
  const dirBytes = new TextEncoder().encode(dirName);

  return {
    environ_sizes_get: (countPtr: number, sizePtr: number) => {
      view().setUint32(countPtr, 0, true);
      view().setUint32(sizePtr, 0, true);
      return ERRNO_SUCCESS;
    },
    environ_get: () => ERRNO_SUCCESS,
    fd_fdstat_set_flags: () => ERRNO_SUCCESS,
    fd_prestat_get: (fd: number, bufPtr: number) => {
      if (fd !== PREOPEN_FD) return ERRNO_BADF;
      view().setUint8(bufPtr, 0); // tag: directory
      view().setUint32(bufPtr + 4, dirBytes.length, true);
      return ERRNO_SUCCESS;
    },
    fd_prestat_dir_name: (fd: number, pathPtr: number, pathLen: number) => {
      if (fd !== PREOPEN_FD) return ERRNO_BADF;
      bytes().set(dirBytes.subarray(0, pathLen), pathPtr);
      return ERRNO_SUCCESS;
    },
    fd_fdstat_get: (fd: number, bufPtr: number) => {
      const isDir = fd === PREOPEN_FD;
      if (!isDir && !open.has(fd) && fd > 2) return ERRNO_BADF;
      const v = view();
      v.setUint8(bufPtr, isDir ? 3 : fd <= 2 ? 2 : 4); // directory / character device / regular file
      v.setUint16(bufPtr + 2, 0, true);
      v.setBigUint64(bufPtr + 8, 0xffffffffffffffffn, true);
      v.setBigUint64(bufPtr + 16, 0xffffffffffffffffn, true);
      return ERRNO_SUCCESS;
    },
    path_open: (
      dirFd: number, _dirflags: number, pathPtr: number, pathLen: number, _oflags: number,
      _rightsBase: bigint, _rightsInheriting: bigint, _fdflags: number, openedFdPtr: number
    ) => {
      if (dirFd !== PREOPEN_FD) return ERRNO_BADF;
      const raw = decoder.decode(bytes().subarray(pathPtr, pathPtr + pathLen));
      const name = raw.split('/').filter(Boolean).pop() ?? '';
      if (!files.has(name)) return ERRNO_NOENT;
      const fd = nextFd++;
      open.set(fd, { name, pos: 0 });
      view().setUint32(openedFdPtr, fd, true);
      return ERRNO_SUCCESS;
    },
    fd_read: (fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number) => {
      const f = open.get(fd);
      if (!f) return ERRNO_BADF;
      const data = files.get(f.name)!;
      const v = view();
      const mem = bytes();
      let total = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = v.getUint32(iovsPtr + i * 8, true);
        const len = v.getUint32(iovsPtr + i * 8 + 4, true);
        const chunk = data.subarray(f.pos, f.pos + len);
        mem.set(chunk, ptr);
        f.pos += chunk.length;
        total += chunk.length;
        if (chunk.length < len) break;
      }
      v.setUint32(nreadPtr, total, true);
      return ERRNO_SUCCESS;
    },
    fd_seek: (fd: number, offset: bigint, whence: number, newOffsetPtr: number) => {
      const f = open.get(fd);
      if (!f) return ERRNO_BADF;
      const size = files.get(f.name)!.length;
      const off = Number(offset);
      const base = whence === 0 ? 0 : whence === 1 ? f.pos : whence === 2 ? size : -1;
      if (base < 0) return ERRNO_INVAL;
      const next = base + off;
      if (next < 0) return ERRNO_INVAL;
      f.pos = next;
      view().setBigUint64(newOffsetPtr, BigInt(next), true);
      return ERRNO_SUCCESS;
    },
    fd_close: (fd: number) => (open.delete(fd) ? ERRNO_SUCCESS : ERRNO_BADF),
    fd_write: (_fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number) => {
      const v = view();
      let total = 0;
      for (let i = 0; i < iovsLen; i++) total += v.getUint32(iovsPtr + i * 8 + 4, true);
      v.setUint32(nwrittenPtr, total, true); // output is discarded
      return ERRNO_SUCCESS;
    },
    proc_exit: (code: number) => {
      throw new Error(`Swiss Ephemeris module exited with code ${code}`);
    },
    random_get: (ptr: number, len: number) => {
      crypto.getRandomValues(bytes().subarray(ptr, ptr + len));
      return ERRNO_SUCCESS;
    },
  };
}
