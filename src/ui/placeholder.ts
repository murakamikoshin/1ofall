/**
 * 選択肢の絵の入口。
 *
 * **中身は `src/ui/art/` に移した。** ここは呼び出し側の入口だけを残す
 * （絵を差し替えるたびに三つの画面を触らないため）。
 *
 * 生成AIで用意する計画だったが、規約（`docs/IMAGE_STYLE.md`）をコードで
 * 描くほうが**守るのではなく外せなくなる**ので、絵そのものをコードにした。
 * 経緯と判断は同文書の §7。
 */
export { choiceArt, artSvg, artImage, hasMotif, VARIANTS, type ArtSpec } from './art/render';
