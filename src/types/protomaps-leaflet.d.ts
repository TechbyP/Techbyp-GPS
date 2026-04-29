declare module 'protomaps-leaflet' {
  export function leafletLayer(options: any): any;
}

declare module 'protomaps-themes-base' {
  export const themes: Record<string, { paintRules?: any; labelRules?: any }>;
}
