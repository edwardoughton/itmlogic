/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/ui/index.html',
    './src/ui/**/*.{js,jsx}',
    './src/components/**/*.{js,jsx}'
  ],
  theme: {
    extend: {
      colors: {
        // 1982 broadcast engineering room — warm navy + sunset gold.
        bg:        '#06111a',
        panel:     '#0b1c26',
        panelDeep: '#07151d',
        panelEdge: 'rgba(255,255,255,0.08)',
        rule:      'rgba(214,163,106,0.22)',
        ruleStrong:'rgba(214,163,106,0.45)',
        text:      '#efe6d6',
        textDim:   '#a89c84',
        amber:     '#ffb347',
        amberDim:  '#c89352',
        gold:      '#d6a36a',
        goldSoft:  '#f3c86d',
        cream:     '#f4eee0',
        cyan:      '#6fd3ff',
        cyanDim:   '#3e7e94',
        red:       '#ff5a5a',
        green:     '#63d471',
        rose:      '#e89972',
        // soft analog tint for late-night mood
        sunset:    '#c4745a',
        navy:      '#0a1a2c'
      },
      fontFamily: {
        mono:    ['"JetBrains Mono"','"IBM Plex Mono"','ui-monospace','Menlo','Consolas','monospace'],
        body:    ['Inter','system-ui','-apple-system','Segoe UI','Roboto','sans-serif'],
        display: ['"Playfair Display"','"Cormorant Garamond"','Georgia','serif']
      },
      letterSpacing: {
        rack: '.18em',
        tag:  '.26em'
      },
      boxShadow: {
        rack:    'inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -1px 0 rgba(0,0,0,0.55), 0 14px 38px -22px rgba(0,0,0,0.85)',
        rackDeep:'inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.7),  0 22px 60px -28px rgba(0,0,0,0.9)',
        ledAmber:'0 0 8px rgba(255,179,71,0.55), 0 0 14px rgba(255,179,71,0.25)',
        ledCyan: '0 0 8px rgba(111,211,255,0.55), 0 0 14px rgba(111,211,255,0.25)',
        ledRed:  '0 0 8px rgba(255,90,90,0.55),   0 0 14px rgba(255,90,90,0.25)',
        ledGreen:'0 0 8px rgba(99,212,113,0.55),  0 0 14px rgba(99,212,113,0.25)'
      }
    }
  },
  plugins: []
};
