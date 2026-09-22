import type { PassportFailureStage } from "../passportTypes";

export type TextFixtureExpectedOutput = {
  pageNo: number;
  filename: string;
  sha256: string;
  evidence: "text_fixture_expected_output";
  expectedVerified: boolean;
  expectedFinalStage?: PassportFailureStage;
  reason: string;
};

/**
 * Expected parser outputs for committed text fixtures.
 *
 * These files are not images and are not evidence that any OCR engine ran.
 */
export const TEXT_FIXTURE_EXPECTED_OUTPUTS: readonly TextFixtureExpectedOutput[] =
  Object.freeze([
    {
      pageNo: 1,
      filename: "page-1.mrz.txt",
      sha256: "a8a51a9765fe6563264d89475f38e1433dd33974b2886b11bda73035d4fcc7d2",
      evidence: "text_fixture_expected_output",
      expectedVerified: false,
      expectedFinalStage: "mrz_parser",
      reason: "Committed text parses as a weak TD3 row; its checksums do not verify.",
    },
    {
      pageNo: 2,
      filename: "page-2.mrz.txt",
      sha256: "f6bb7d8acf9aeadcd0da3881d3328bc3b639822f78f5425905797bd9748f99fb",
      evidence: "text_fixture_expected_output",
      expectedVerified: false,
      expectedFinalStage: "mrz_parser",
      reason: "Committed text parses as the same weak TD3 row; it is not image evidence.",
    },
    {
      pageNo: 3,
      filename: "page-3.name-line.txt",
      sha256: "a74691bbe8918800d91cb98287981ce5fbfb3f04983cefc16bd527e983b8a9a7",
      evidence: "text_fixture_expected_output",
      expectedVerified: false,
      expectedFinalStage: "field_matching",
      reason: "The invalid synthetic surname token is rejected before row creation.",
    },
    {
      pageNo: 4,
      filename: "page-4.no-band.txt",
      sha256: "bed8f3d209fc375b29a9b3c98a38a4a96bc5fc6cff52070e5e22d2ef3949acb8",
      evidence: "text_fixture_expected_output",
      expectedVerified: false,
      expectedFinalStage: "text_detection",
      reason: "No MRZ text is present.",
    },
    {
      pageNo: 5,
      filename: "page-5.grid-fail.txt",
      sha256: "00c2d409314dcde75c840fe6e7043ddd8f181607bec79e6c92574af5a8fe950b",
      evidence: "text_fixture_expected_output",
      expectedVerified: false,
      expectedFinalStage: "character_recognition",
      reason: "Only a recorded expected failure label is present.",
    },
  ]);
