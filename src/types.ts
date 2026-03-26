export type CropMode = 'top' | 'offset' | 'bottom';
export type OffsetInputMode = 'pixel' | 'page';
export type CropPresetId = 'desktop' | 'mobile';

export type ProcessOptions = {
  mode: CropMode;
  n: number;
};

export type ProcessResult = {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
};
