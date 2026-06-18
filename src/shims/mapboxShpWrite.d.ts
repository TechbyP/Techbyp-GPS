declare module '@mapbox/shp-write' {
  type ShpWriteGeometry = {
    type: string;
    coordinates: unknown;
  };

  type ShpWriteFeature = {
    type: 'Feature';
    geometry: ShpWriteGeometry;
    properties?: Record<string, string | number | boolean | null | undefined>;
  };

  type ShpWriteFeatureCollection = {
    type: 'FeatureCollection';
    features: ShpWriteFeature[];
  };

  type ShpWriteZipOptions = {
    folder?: string;
    filename?: string;
    outputType?: 'blob' | 'arraybuffer' | 'uint8array' | 'string' | 'text' | 'binarystring' | 'array' | 'base64' | 'nodebuffer' | 'stream';
    compression?: 'STORE' | 'DEFLATE';
    prj?: string;
    types?: {
      point?: string;
      polygon?: string;
      line?: string;
      multipolygon?: string;
      multiline?: string;
      polyline?: string;
    };
  };

  const shpwrite: {
    zip: (geojson: ShpWriteFeatureCollection, options?: ShpWriteZipOptions) => Promise<ArrayBuffer | Blob | Uint8Array | number[] | string>;
  };

  export default shpwrite;
}