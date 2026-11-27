// Glide engine: ExoPlayer + a GPU frame-interpolation (MEMC) effect, and optical-flow export.
export { GlidePlayer } from './src/GlidePlayer';
export {
  addExportDamagedListener,
  addExportProgressListener,
  answerExportDamaged,
  cancelExport,
  exportSmooth,
  getDisplayInfo,
  getVolume,
  isEngineAvailable,
  setVolume,
  shareVideo,
  shareVideos,
} from './src/GlideEngineModule';
export type * from './src/GlideEngine.types';
