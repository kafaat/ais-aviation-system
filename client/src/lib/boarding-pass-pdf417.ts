import { drawingSVG, pdf417 } from "bwip-js/browser";

export function renderBoardingPassPDF417(text: string): string {
  const options = {
    bcid: "pdf417",
    text,
    scale: 2,
    columns: 12,
    eclevel: 5,
    paddingwidth: 2,
    paddingheight: 2,
  };
  return pdf417(options, drawingSVG());
}
