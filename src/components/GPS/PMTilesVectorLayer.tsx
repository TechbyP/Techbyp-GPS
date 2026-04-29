import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

interface PMTilesVectorLayerProps {
  pmtilesUrl?: string | null;
  url?: string | null;
  attribution?: string;
  maxZoom?: number;
  maxDataZoom?: number;
  opacity?: number;
  theme?: 'light' | 'dark';
  schema?: 'protomaps' | 'openmaptiles';
}

export default function PMTilesVectorLayer({
  pmtilesUrl,
  url,
  attribution = '© OpenStreetMap contributors',
  maxZoom = 19,
  maxDataZoom = 15,
  opacity = 1,
  theme = 'light',
  schema = 'protomaps',
}: PMTilesVectorLayerProps) {
  const map = useMap();
  const layerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    const attachLayer = async () => {
      const resolvedUrl = pmtilesUrl ?? url;
      if (!resolvedUrl) return;

      const [{
        leafletLayer,
        PolygonSymbolizer,
        LineSymbolizer,
        CenteredTextSymbolizer,
        LineLabelSymbolizer,
        ShieldSymbolizer,
        createPattern,
        paintRules: defaultPaintRules,
        labelRules: defaultLabelRules,
      }, themesModule] = await Promise.all([
        import('protomaps-leaflet'),
        import('protomaps-themes-base'),
      ]);

      if (cancelled) return;

      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }

      const moduleAny = themesModule as any;
      const themes = moduleAny.themes || moduleAny.default?.themes || moduleAny.default || moduleAny;
      const selectedTheme =
        themes?.[theme] ||
        moduleAny?.[theme] ||
        moduleAny?.default?.[theme] ||
        themes?.light ||
        moduleAny?.light ||
        moduleAny?.default?.light ||
        themes;

      let paint_rules: any[] | undefined;
      let label_rules: any[] | undefined;
      let backgroundColor: string | undefined;

      if (schema === 'openmaptiles') {
        const landColor = '#f2efe9';
        const farmlandColor = '#f1e6b8';
        const orchardColor = '#e5d1a0';
        const vineyardColor = '#d4bf8f';
        const grassColor = '#d9efc8';
        const meadowColor = '#cde6b8';
        const scrubColor = '#d1d8ad';
        const wetlandColor = '#c5e4db';
        const forestColor = '#b5d7a0';
        const residentialColor = '#f2e8e2';
        const industrialColor = '#e3ddea';
        const cemeteryColor = '#cfe6c8';
        const sportsColor = '#d6f0d1';
        const beachColor = '#f3e7c9';
        const waterColor = '#a7c8ee';
        const waterStroke = '#7fb0e3';
        const roadCasing = '#8f8f8f';
        const roadFill = '#ffffff';
        const minorRoad = '#f5f5f5';
        const pathColor = '#d4b891';
        const highway = '#f2b07e';
        const motorway = '#f08a5d';
        const railColor = '#b58ca4';
        const forestPattern = createPattern(8, 8, (_c, ctx) => {
          ctx.fillStyle = forestColor;
          ctx.fillRect(0, 0, 8, 8);
          ctx.strokeStyle = '#8cbf79';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, 8);
          ctx.lineTo(8, 0);
          ctx.stroke();
        });
        const meadowPattern = createPattern(8, 8, (_c, ctx) => {
          ctx.fillStyle = meadowColor;
          ctx.fillRect(0, 0, 8, 8);
          ctx.fillStyle = '#9fc87f';
          ctx.beginPath();
          ctx.arc(2, 2, 1, 0, Math.PI * 2);
          ctx.arc(6, 6, 1, 0, Math.PI * 2);
          ctx.fill();
        });
        const farmlandPattern = createPattern(8, 8, (_c, ctx) => {
          ctx.fillStyle = farmlandColor;
          ctx.fillRect(0, 0, 8, 8);
          ctx.strokeStyle = '#d1c08a';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, 4);
          ctx.lineTo(8, 4);
          ctx.moveTo(4, 0);
          ctx.lineTo(4, 8);
          ctx.stroke();
        });
        const orchardPattern = createPattern(8, 8, (_c, ctx) => {
          ctx.fillStyle = orchardColor;
          ctx.fillRect(0, 0, 8, 8);
          ctx.fillStyle = '#b88f4a';
          ctx.beginPath();
          ctx.arc(2, 6, 1, 0, Math.PI * 2);
          ctx.arc(6, 2, 1, 0, Math.PI * 2);
          ctx.fill();
        });
        paint_rules = [
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({ fill: landColor }),
          },
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({
              fill: farmlandColor,
              pattern: farmlandPattern,
              opacity: 0.7,
              stroke: '#d9caa0',
              width: 0.4,
            }),
            filter: (_z, f) =>
              ['farmland', 'farmyard'].includes(f?.props?.class),
          },
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({
              fill: orchardColor,
              pattern: orchardPattern,
              opacity: 0.7,
              stroke: '#c4a86a',
              width: 0.4,
            }),
            filter: (_z, f) => ['orchard'].includes(f?.props?.class),
          },
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({
              fill: vineyardColor,
              opacity: 0.7,
              stroke: '#b49a68',
              width: 0.4,
            }),
            filter: (_z, f) => ['vineyard'].includes(f?.props?.class),
          },
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({
              fill: grassColor,
              opacity: 0.65,
              stroke: '#b7d39f',
              width: 0.3,
            }),
            filter: (_z, f) => ['grass', 'village_green'].includes(f?.props?.class),
          },
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({
              fill: meadowColor,
              pattern: meadowPattern,
              opacity: 0.65,
              stroke: '#a8c987',
              width: 0.3,
            }),
            filter: (_z, f) => ['meadow'].includes(f?.props?.class),
          },
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({
              fill: forestColor,
              pattern: forestPattern,
              opacity: 0.7,
              stroke: '#87b06e',
              width: 0.4,
            }),
            filter: (_z, f) => ['forest', 'wood'].includes(f?.props?.class),
          },
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({
              fill: scrubColor,
              opacity: 0.65,
              stroke: '#a4b284',
              width: 0.3,
            }),
            filter: (_z, f) => ['scrub'].includes(f?.props?.class),
          },
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({
              fill: wetlandColor,
              opacity: 0.65,
              stroke: '#9ac3b4',
              width: 0.3,
            }),
            filter: (_z, f) => ['wetland'].includes(f?.props?.class),
          },
          {
            dataLayer: 'natural',
            symbolizer: new PolygonSymbolizer({
              fill: forestColor,
              pattern: forestPattern,
              opacity: 0.75,
              stroke: '#7ea765',
              width: 0.4,
            }),
            filter: (_z, f) => ['wood', 'forest'].includes(f?.props?.class || f?.props?.natural),
          },
          {
            dataLayer: 'natural',
            symbolizer: new PolygonSymbolizer({
              fill: meadowColor,
              pattern: meadowPattern,
              opacity: 0.7,
              stroke: '#9bbd7b',
              width: 0.3,
            }),
            filter: (_z, f) => ['grassland', 'grass', 'meadow', 'heath'].includes(f?.props?.class || f?.props?.natural),
          },
          {
            dataLayer: 'natural',
            symbolizer: new PolygonSymbolizer({
              fill: scrubColor,
              opacity: 0.7,
              stroke: '#9aa87a',
              width: 0.3,
            }),
            filter: (_z, f) => ['scrub'].includes(f?.props?.class || f?.props?.natural),
          },
          {
            dataLayer: 'natural',
            symbolizer: new PolygonSymbolizer({
              fill: wetlandColor,
              opacity: 0.7,
              stroke: '#8fb6a8',
              width: 0.3,
            }),
            filter: (_z, f) => ['wetland', 'marsh', 'bog', 'fen', 'swamp'].includes(f?.props?.class || f?.props?.natural),
          },
          {
            dataLayer: 'natural',
            symbolizer: new PolygonSymbolizer({
              fill: beachColor,
              opacity: 0.7,
              stroke: '#d7c6a4',
              width: 0.3,
            }),
            filter: (_z, f) => ['sand', 'beach'].includes(f?.props?.class || f?.props?.natural),
          },
          {
            dataLayer: 'landcover',
            symbolizer: new PolygonSymbolizer({ fill: forestColor, pattern: forestPattern }),
            filter: (_z, f) => ['wood', 'forest'].includes(f?.props?.class),
          },
          {
            dataLayer: 'landcover',
            symbolizer: new PolygonSymbolizer({ fill: scrubColor }),
            filter: (_z, f) => ['scrub'].includes(f?.props?.class),
          },
          {
            dataLayer: 'landcover',
            symbolizer: new PolygonSymbolizer({ fill: wetlandColor }),
            filter: (_z, f) => ['wetland'].includes(f?.props?.class),
          },
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({ fill: residentialColor }),
            filter: (_z, f) => ['residential'].includes(f?.props?.class),
          },
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({ fill: industrialColor }),
            filter: (_z, f) => ['industrial', 'commercial', 'retail'].includes(f?.props?.class),
          },
          {
            dataLayer: 'park',
            symbolizer: new PolygonSymbolizer({ fill: '#cfe8c8' }),
          },
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({ fill: cemeteryColor }),
            filter: (_z, f) => ['cemetery'].includes(f?.props?.class),
          },
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({ fill: sportsColor }),
            filter: (_z, f) => ['stadium', 'sports_centre', 'pitch', 'track'].includes(f?.props?.class),
          },
          {
            dataLayer: 'landuse',
            symbolizer: new PolygonSymbolizer({ fill: beachColor }),
            filter: (_z, f) => ['beach'].includes(f?.props?.class),
          },
          {
            dataLayer: 'water',
            symbolizer: new PolygonSymbolizer({ fill: waterColor }),
          },
          {
            dataLayer: 'waterway',
            symbolizer: new LineSymbolizer({ color: waterStroke, width: 1.1 }),
          },
          {
            dataLayer: 'boundary',
            symbolizer: new LineSymbolizer({ color: '#9aa0a6', width: 1 }),
          },
          {
            dataLayer: 'transportation',
            symbolizer: new LineSymbolizer({
              color: roadCasing,
              width: (z: number) => (z >= 13 ? 3.2 : z >= 11 ? 2.4 : 1.6),
            }),
            filter: (_z, f) =>
              ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(f?.props?.class),
          },
          {
            dataLayer: 'transportation',
            symbolizer: new LineSymbolizer({
              color: highway,
              width: (z: number) => (z >= 13 ? 2.4 : z >= 11 ? 1.8 : 1.2),
            }),
            filter: (_z, f) =>
              ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(f?.props?.class),
          },
          {
            dataLayer: 'transportation',
            symbolizer: new LineSymbolizer({
              color: motorway,
              width: (z: number) => (z >= 12 ? 2.6 : 1.6),
            }),
            filter: (_z, f) => ['motorway', 'trunk'].includes(f?.props?.class),
          },
          {
            dataLayer: 'transportation',
            symbolizer: new LineSymbolizer({
              color: roadCasing,
              width: (z: number) => (z >= 14 ? 2.4 : z >= 12 ? 1.8 : 1.2),
            }),
            filter: (_z, f) =>
              ['residential', 'minor', 'service'].includes(f?.props?.class),
          },
          {
            dataLayer: 'transportation',
            symbolizer: new LineSymbolizer({
              color: roadFill,
              width: (z: number) => (z >= 14 ? 1.6 : z >= 12 ? 1.2 : 0.9),
            }),
            filter: (_z, f) =>
              ['residential', 'minor', 'service'].includes(f?.props?.class),
          },
          {
            dataLayer: 'transportation',
            symbolizer: new LineSymbolizer({
              color: pathColor,
              width: (z: number) => (z >= 16 ? 2.0 : z >= 14 ? 1.5 : 1.0),
            }),
            filter: (_z, f) => ['track', 'path', 'footway', 'cycleway'].includes(f?.props?.class),
          },
          {
            dataLayer: 'transportation',
            symbolizer: new LineSymbolizer({
              color: '#c7a36b',
              width: (z: number) => (z >= 15 ? 1.6 : 1.0),
              opacity: 0.7,
            }),
            filter: (_z, f) => ['track'].includes(f?.props?.class),
          },
          {
            dataLayer: 'transportation',
            symbolizer: new LineSymbolizer({ color: '#b0b0b0', width: 1.2 }),
          },
          {
            dataLayer: 'transportation',
            symbolizer: new LineSymbolizer({ color: railColor, width: 1.4 }),
            filter: (_z, f) => ['rail', 'subway', 'light_rail', 'tram'].includes(f?.props?.class),
          },
          {
            dataLayer: 'building',
            symbolizer: new PolygonSymbolizer({ fill: '#d9d2c7', stroke: '#b8b0a6', width: 0.3 }),
          },
        ];
        label_rules = [
          {
            id: 'omt-place-labels',
            dataLayer: 'place',
            minzoom: 6,
            symbolizer: new CenteredTextSymbolizer({
              font: '12px "Segoe UI", sans-serif',
              fill: '#3a3a3a',
              stroke: '#ffffff',
              width: 2,
            }),
            filter: (_z, f) => Boolean(f?.props?.name),
          },
          {
            id: 'omt-place-labels-large',
            dataLayer: 'place',
            minzoom: 4,
            symbolizer: new CenteredTextSymbolizer({
              font: (z: number) => (z >= 7 ? '14px "Segoe UI", sans-serif' : '13px "Segoe UI", sans-serif'),
              fill: '#2f2f2f',
              stroke: '#ffffff',
              width: 2,
            }),
            filter: (_z, f) => Boolean(f?.props?.name) && (f?.props?.class === 'city' || f?.props?.class === 'town'),
          },
          {
            id: 'omt-place-labels-small',
            dataLayer: 'place',
            minzoom: 10,
            symbolizer: new CenteredTextSymbolizer({
              font: '10px "Segoe UI", sans-serif',
              fill: '#4a4a4a',
              stroke: '#ffffff',
              width: 2,
            }),
            filter: (_z, f) =>
              Boolean(f?.props?.name) &&
              ['village', 'suburb', 'neighbourhood', 'hamlet', 'locality'].includes(f?.props?.class),
          },
          {
            id: 'omt-transportation-labels',
            dataLayer: 'transportation_name',
            minzoom: 12,
            symbolizer: new LineLabelSymbolizer({
              font: '11px "Segoe UI", sans-serif',
              fill: '#4a4a4a',
              stroke: '#ffffff',
              width: 3,
              label_props: ['name', 'ref'],
              repeatDistance: 350,
            }),
            filter: (_z, f) => Boolean(f?.props?.name || f?.props?.ref),
          },
          {
            id: 'omt-transportation-labels-minor',
            dataLayer: 'transportation_name',
            minzoom: 14,
            symbolizer: new LineLabelSymbolizer({
              font: '10px "Segoe UI", sans-serif',
              fill: '#5a5a5a',
              stroke: '#ffffff',
              width: 2,
              label_props: ['name'],
              repeatDistance: 220,
            }),
            filter: (_z, f) =>
              Boolean(f?.props?.name) &&
              ['residential', 'minor', 'service', 'track', 'path'].includes(f?.props?.class),
          },
          {
            id: 'omt-transportation-shields',
            dataLayer: 'transportation_name',
            minzoom: 9,
            symbolizer: new ShieldSymbolizer({
              font: '11px "Segoe UI", sans-serif',
              fill: '#2f2f2f',
              background: '#ffffff',
              padding: 2,
              label_props: ['ref'],
            }),
            filter: (_z, f) => Boolean(f?.props?.ref),
          },
          {
            id: 'omt-water-labels',
            dataLayer: 'water_name',
            minzoom: 10,
            symbolizer: new CenteredTextSymbolizer({
              font: '11px "Segoe UI", sans-serif',
              fill: '#3d6ea6',
              stroke: '#ffffff',
              width: 2,
            }),
            filter: (_z, f) => Boolean(f?.props?.name),
          },
          {
            id: 'omt-poi-labels',
            dataLayer: 'poi',
            minzoom: 14,
            symbolizer: new CenteredTextSymbolizer({
              font: '10px "Segoe UI", sans-serif',
              fill: '#4a4a4a',
              stroke: '#ffffff',
              width: 2,
            }),
            filter: (_z, f) => Boolean(f?.props?.name),
          },
          {
            id: 'omt-farm-poi-labels',
            dataLayer: 'poi',
            minzoom: 13,
            symbolizer: new CenteredTextSymbolizer({
              font: '11px "Segoe UI", sans-serif',
              fill: '#4b6b3c',
              stroke: '#ffffff',
              width: 2,
            }),
            filter: (_z, f) =>
              Boolean(f?.props?.name) &&
              ['farm', 'farmyard', 'barn', 'greenhouse', 'livestock'].includes(
                f?.props?.class || f?.props?.subclass
              ),
          },
        ];
        backgroundColor = landColor;
      } else if (selectedTheme) {
        paint_rules = defaultPaintRules(selectedTheme);
        label_rules = defaultLabelRules(selectedTheme);
        backgroundColor = selectedTheme?.background;
      }

      const layer = leafletLayer({
        url: resolvedUrl,
        maxZoom,
        maxDataZoom,
        attribution,
        paint_rules,
        label_rules,
        backgroundColor,
      });

      if (layer.setOpacity) {
        layer.setOpacity(opacity);
      }

      layer.addTo(map);
      layerRef.current = layer;
    };

    attachLayer();

    return () => {
      cancelled = true;
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [pmtilesUrl, url, map, attribution, maxZoom, maxDataZoom, opacity, theme, schema]);

  return null;
}
