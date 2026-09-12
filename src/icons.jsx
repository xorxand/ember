import React from 'react';
const paths = {
 plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6', search: 'm21 21-4.5-4.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
 chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z',
 folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
 models: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
 download: 'M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
 upload: 'M12 16V4m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
 arrow: 'M12 19V5m-6 6 6-6 6 6', right: 'm9 5 7 7-7 7', down: 'm6 9 6 6 6-6',
 check: 'm5 12 4 4L19 6', circle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
 settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.2 4a7 7 0 0 0-.1-1.2l1.4-1.1-1.5-2.6-1.7.6a8 8 0 0 0-2-1.2L16 4h-3l-.4 2.3a8 8 0 0 0-2 1.2l-1.7-.6-1.5 2.6 1.4 1.1a7 7 0 0 0 0 2.4l-1.4 1.1 1.5 2.6 1.7-.6a8 8 0 0 0 2 1.2L13 20h3l.3-2.3a8 8 0 0 0 2-1.2l1.7.6 1.5-2.6-1.4-1.1a7 7 0 0 0 .1-1.4Z',
 sliders: 'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6',
 terminal: 'm4 5 6 6-6 6m9 1h7', file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8M8 17h6',
 code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18', copy: 'M9 9h12v12H9V9ZM15 9V3H3v12h6',
 trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
 refresh: 'M20 7v5h-5M4 17v-5h5M6.1 6a8 8 0 0 1 13.2 3M4.7 15A8 8 0 0 0 18 18',
 spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
 chip: 'M7 7h10v10H7V7ZM4 9H1m3 6H1m22-6h-3m3 6h-3M9 4V1m6 3V1M9 23v-3m6 3v-3M4 4h16v16H4V4Z',
 globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z',
 external: 'M14 3h7v7m0-7L10 14M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6',
 panel: 'M3 4h18v16H3V4Zm12 0v16', clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
 stop: 'M6 6h12v12H6V6Z', play: 'm7 4 14 8-14 8V4Z', pause: 'M8 4v16M16 4v16',
 archive: 'M3 3h18v5H3V3Zm2 5v13h14V8M9 12h6', paperclip: 'm21 11-8.5 8.5a6 6 0 0 1-8.5-8.5L13 2a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5',
 sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 1v2m0 18v2M1 12h2m18 0h2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
 moon: 'M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13Z', info: 'M12 11v6m0-10v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
 branch: 'M6 3v12a4 4 0 0 0 4 4h2m-6-9h8a4 4 0 0 0 4-4V3M8 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm12 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm-4 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
 more: 'M5 12h.01M12 12h.01M19 12h.01', eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 10 3 3 5-6'
};
export default function Icon({ name, size = 18, ...props }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths.circle}/></svg>; }
export function Logo({ size = 28 }) { return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M8 24V14m8 10V7m8 17V11" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/><path d="M5 28h22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".3"/></svg>; }
