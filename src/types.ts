export type CropMode = 'top' | 'offset' | 'bottom';
export type OffsetInputMode = 'pixel' | 'page';

export type ProcessOptions = {
  mode: CropMode;
  n: number;
};

export type ProcessResult = {
  blob: Blob;
  dataUrl: string;
  width: 1920;
  height: 1080;
};
