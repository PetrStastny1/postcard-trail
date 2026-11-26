import { t } from '../i18n/index.ts'
import { element } from './element.ts'

// Drawn after stop PAR03: a boat on the river, the iron tower behind and reflections by the quay.
// Colours come from the --scene-* tokens through the classes in title.css, so the scene costs no image request.
const sceneArt = `
<svg class="title-art" viewBox="0 0 1280 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="title-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="title-sky-top" />
      <stop offset="0.6" class="title-sky-middle" />
      <stop offset="1" class="title-sky-bottom" />
    </linearGradient>
  </defs>
  <rect class="title-sky" width="1280" height="640" />
  <circle class="title-sun" cx="300" cy="230" r="70" />
  <path class="title-far" d="M0 560 L90 530 L170 545 L260 500 L360 530 L470 505 L560 540 L700 520 L760 545 L1060 520 L1160 540 L1280 515 V640 H0 Z" />
  <g class="title-tower">
    <path d="M815 600 L848 600 L886 440 L866 440 Z M985 600 L952 600 L914 440 L934 440 Z" />
    <path d="M868 432 L932 432 L916 300 L884 300 Z M886 292 L914 292 L904 150 L896 150 Z" />
    <rect x="856" y="428" width="88" height="14" />
    <rect x="874" y="290" width="52" height="10" />
    <rect x="889" y="140" width="22" height="10" />
    <path class="title-tower-line" d="M900 140 V100 M856 600 Q900 500 944 600" />
  </g>
  <path class="title-trees" d="M0 600 Q30 540 70 570 Q110 520 150 565 Q190 530 230 575 Q260 560 280 600 Z M1090 600 Q1120 550 1160 575 Q1200 535 1240 570 Q1265 555 1280 565 V600 Z" />
  <rect class="title-quay" y="600" width="1280" height="40" />
  <path class="title-quay-edge" d="M0 640 H1280" />
  <rect class="title-water" y="640" width="1280" height="160" />
  <g class="title-reflections">
    <path class="title-tower-reflection" d="M866 646 L934 646 L914 720 L886 720 Z M893 724 L907 724 L902 780 L898 780 Z" />
    <path class="title-shimmer" d="M120 670 H380 M560 700 H760 M840 668 H1020 M980 740 H1200 M200 760 H460" />
    <path class="title-shimmer title-shimmer-late" d="M60 720 H240 M460 664 H600 M700 760 H900 M1080 690 H1240" />
  </g>
  <g class="title-boat">
    <g class="title-boat-bob">
      <path class="title-boat-hull" d="M280 690 L500 690 L478 722 L300 722 Z" />
      <rect class="title-boat-cabin" x="320" y="662" width="140" height="28" rx="6" />
      <path class="title-boat-windows" d="M340 676 H360 M380 676 H400 M420 676 H440" />
      <path class="title-boat-wake" d="M250 728 H300 M480 728 H520" />
    </g>
  </g>
</svg>`

export function titleScene(): HTMLElement {
  const figure = element('figure', { class: 'title-scene', role: 'img', 'aria-label': t('title.scene') })
  figure.innerHTML = sceneArt
  return figure
}
