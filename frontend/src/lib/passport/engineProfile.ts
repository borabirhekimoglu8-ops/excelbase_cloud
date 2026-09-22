export type PassportEngineProfile = {
  id: string;
  mrzLanguage: "mrz";
  vizLanguage: "eng";
  oem: "lstm-only";
  dpi: 300;
  maxWorkers: 1;
};

export const PASSPORT_ENGINE_PROFILE: PassportEngineProfile = Object.freeze({
  id: "tesseract-6-mrz-eng-lstm-300dpi-v1",
  mrzLanguage: "mrz",
  vizLanguage: "eng",
  oem: "lstm-only",
  dpi: 300,
  maxWorkers: 1,
});
