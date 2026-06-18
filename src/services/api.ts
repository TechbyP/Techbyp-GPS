import { hybridDB } from './hybridDatabase';
import shp from 'shpjs';

// Helper to ensure ID is string
const toId = (id: number | string): string => id.toString();

export const gpsAPI = {
  // Projects
  getProjects: async () => {
    return await hybridDB.getProjects();
  },

  getProject: async (projectId: number | string) => {
    const projects = await hybridDB.getProjects();
    return projects.find((p: any) => p.id.toString() === toId(projectId));
  },

  createProject: async (name: string, description?: string) => {
    return await hybridDB.createProject(name, description || '');
  },

  updateProject: async (projectId: number | string, name: string, description?: string) => {
    return await hybridDB.updateProject(toId(projectId), name, description);
  },

  deleteProject: async (projectId: number | string) => {
    return await hybridDB.deleteProject(toId(projectId));
  },

  // Tracks
  getTracks: async (projectId: number | string) => {
    return await hybridDB.getTracks(toId(projectId));
  },

  getTrack: async (trackId: number | string) => {
    return await hybridDB.getTrack(toId(trackId));
  },

  createTrack: async (projectId: number | string, name: string, fieldBoundaryId?: number | string) => {
    return await hybridDB.createTrack(toId(projectId), name, fieldBoundaryId ? toId(fieldBoundaryId) : undefined);
  },

  deleteTrack: async (trackId: number | string) => {
    return await hybridDB.deleteTrack(toId(trackId));
  },

  updateTrack: async (trackId: number | string, updates: { name?: string; field_boundary_id?: number | string | null; color?: string }) => {
    const convertedUpdates = {
      ...updates,
      field_boundary_id: updates.field_boundary_id ? toId(updates.field_boundary_id) : updates.field_boundary_id
    };
    return await hybridDB.updateTrack(toId(trackId), convertedUpdates);
  },

  // GPS Points
  addGpsPoint: async (trackId: number | string, latitude: number, longitude: number, altitude?: number, accuracy?: number) => {
    return await hybridDB.addGpsPoint(toId(trackId), latitude, longitude, altitude, accuracy);
  },

  getGpsPoints: async (trackId: number | string) => {
    return await hybridDB.getGpsPoints(toId(trackId));
  },

  // Samples
  addSample: async (trackId: number | string, latitude: number, longitude: number, name: string, notes?: string) => {
    return await hybridDB.addSample(toId(trackId), latitude, longitude, name, notes);
  },

  getSamples: async (trackId: number | string) => {
    return await hybridDB.getSamples(toId(trackId));
  },

  deleteSample: async (sampleId: number | string) => {
    return await hybridDB.deleteSample(toId(sampleId));
  },

  // Field Boundaries (Shapefile Import)
  uploadShapefile: async (
    projectId: number | string,
    shpFile: File,
    shxFile: File,
    dbfFile: File,
    prjFile: File | null,
    cpgFile: File | null,
    name: string,
    color?: string
  ) => {
    // shxFile is not strictly needed for basic parsing if shp is good, but we keep it in signature
    void shxFile;

    try {
      // Client-side parsing using shpjs
      // shpjs accepts an object with shp, dbf, prj, and cpg buffers
      const shapefileObject: any = {
        shp: await shpFile.arrayBuffer(),
        dbf: await dbfFile.arrayBuffer()
      };
      
      // Add optional files if provided
      if (prjFile) {
        shapefileObject.prj = await prjFile.text();
      }
      if (cpgFile) {
        shapefileObject.cpg = await cpgFile.text();
      }
      
      // Parse to GeoJSON - shpjs returns GeoJSON directly
      const geojson = await shp(shapefileObject as Record<string, unknown>) as any;
      
      console.log('Parsed shapefile to GeoJSON:', geojson);
      
      // Save each feature as a boundary
      if (geojson.type === 'FeatureCollection') {
        const results = [];
        for (const feature of geojson.features) {
          // Extract field name from shapefile properties
          const fieldNameFromFile = feature.properties?.name || feature.properties?.NAME || 
                                    feature.properties?.field_name || feature.properties?.FIELD_NAME ||
                                    feature.properties?.id || feature.properties?.ID || null;
          
          // Create boundary name: "Assigned Name - Field Name" or just "Assigned Name" if no field name
          const boundaryName = fieldNameFromFile 
            ? `${name} - ${fieldNameFromFile}`
            : name;
          
          // Normalize properties to match expected field names in the edit form
          // Keep all original properties and add standardized versions
          const normalizedProperties = {
            ...feature.properties, // Keep all original properties
            // Map common crop field names
            CROP: feature.properties?.CROP || feature.properties?.crop || 
                  feature.properties?.Crop || feature.properties?.CROP_TYPE ||
                  feature.properties?.crop_type || feature.properties?.CropType || '',
            // Map common season/year field names  
            season: feature.properties?.season || feature.properties?.Season || 
                   feature.properties?.SEASON || feature.properties?.year || 
                   feature.properties?.Year || feature.properties?.YEAR || '',
            // Map planting date field names
            season_start: feature.properties?.season_start || feature.properties?.PLANT_DATE ||
                         feature.properties?.plant_date || feature.properties?.PlantDate ||
                         feature.properties?.START_DATE || feature.properties?.start_date || '',
            // Map harvest date field names
            season_end: feature.properties?.season_end || feature.properties?.HARVEST_DATE ||
                       feature.properties?.harvest_date || feature.properties?.HarvestDate ||
                       feature.properties?.END_DATE || feature.properties?.end_date || '',
            // Map ID field names
            uid: feature.properties?.uid || feature.properties?.UID || 
                feature.properties?.ID || feature.properties?.id ||
                feature.properties?.FIELD_ID || feature.properties?.field_id || 
                feature.properties?.FieldID || ''
          };
          
          const result = await hybridDB.createFieldBoundary(
            toId(projectId),
            boundaryName,
            feature.geometry,
            color || '#00FF00',
            normalizedProperties
          );
          results.push(result);
        }
        return results;
      } else if (geojson.type === 'Feature') {
        // Single feature
        return await hybridDB.createFieldBoundary(
          toId(projectId),
          name,
          geojson.geometry,
          color || '#00FF00',
          geojson.properties
        );
      } else {
        throw new Error("Unsupported GeoJSON type: " + geojson.type);
      }
    } catch (error) {
      console.error("Shapefile parse error:", error);
      throw new Error("Failed to parse shapefile client-side: " + (error as any).message);
    }
  },

  getFieldBoundaries: async (projectId: number | string) => {
    return await hybridDB.getFieldBoundaries(toId(projectId));
  },

  createFieldBoundary: async (
    projectId: number | string, 
    name: string, 
    geometryType: string, 
    coordinates: any, 
    properties: any, 
    color: string
  ) => {
    const geometry = {
      type: geometryType,
      coordinates: coordinates
    };
    return await hybridDB.createFieldBoundary(toId(projectId), name, geometry, color, properties);
  },

  updateFieldBoundary: async (
    boundaryId: number | string,
    name?: string,
    properties?: any,
    color?: string
  ) => {
    return await hybridDB.updateFieldBoundary(toId(boundaryId), name, undefined, color, properties);
  },

  deleteFieldBoundary: async (boundaryId: number | string) => {
    return await hybridDB.deleteFieldBoundary(toId(boundaryId));
  },

  // Devices
  getDevices: async () => {
    return await hybridDB.getDevices();
  },

  saveDevice: async (device: any) => {
    return await hybridDB.saveDevice(device);
  },

  deleteDevice: async (deviceId: number | string) => {
    return await hybridDB.deleteDevice(toId(deviceId));
  },

  // Database status
  getDatabaseStatus: async () => {
    const status = hybridDB.getStatus();
    return {
      type: 'hybrid',
      ...status
    };
  },

  syncNow: async () => {
    await hybridDB.forceSyncNow();
    return hybridDB.getStatus();
  },
};
