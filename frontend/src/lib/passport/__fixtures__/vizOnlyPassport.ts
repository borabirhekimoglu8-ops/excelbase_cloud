import words from "./vizWords.ada.json";
import type { VizWord } from "../vizFields";

export const VIZ_ONLY_PASSPORT = Object.freeze({
  filename: "ada-yilmaz-mrz-kesik.jpg",
  pageNo: 1,
  width: 900,
  height: 600,
  mrzVisible: false,
  words: words as VizWord[],
});
