// The public surface of the code-test module: experiments run from Administration ->
// Code Tester. Import from here, never from a file inside it.
//
// Each experiment is one use-case that returns a plain-text report. A new experiment is
// a new file here plus one card on the Code Tester screen.
export type { ImageLibInfo, ImageLibProbe, ImageMetadata, TimedPhotoReader } from "./ports";
export { serverResizeTestSchema, type ServerResizeTestInput } from "./schema";
export {
  RESIZE_LONG_EDGES,
  testServerResizeImage,
  type ServerResizeTestDeps,
} from "./test-server-resize-image";
export { SharpImageLibProbe, createTimedPhotoReader } from "./image-lib-probe";
