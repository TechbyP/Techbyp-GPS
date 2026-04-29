/**
 * USB Serial GPS Hook
 * Connects to USB GPS devices using Web Serial API
 * Supports NMEA 0183 protocol over USB serial
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { GpsPositionUpdate } from '../types';

interface UseSerialGPSOptions {
  onPosition?: (position: GpsPositionUpdate) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

interface SerialGPSState {
  isConnected: boolean;
  isConnecting: boolean;
  deviceInfo: { name: string; vendorId?: number; productId?: number } | null;
  lastPosition: GpsPositionUpdate | null;
  error: string | null;
}

export function useSerialGPS(options: UseSerialGPSOptions = {}) {
  const [state, setState] = useState<SerialGPSState>({
    isConnected: false,
    isConnecting: false,
    deviceInfo: null,
    lastPosition: null,
    error: null,
  });

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const nmeaBufferRef = useRef<string>('');
  
  // Use refs for callbacks to avoid dependency issues
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Check if Web Serial API is supported
  const isSupported = useCallback(() => {
    return 'serial' in navigator;
  }, []);

  // Parse NMEA sentence
  const parseNMEA = useCallback((sentence: string): GpsPositionUpdate | null => {
    const parts = sentence.split(',');
    
    // Handle GGA (Fix data)
    if (parts[0] === '$GPGGA' || parts[0] === '$GNGGA') {
      const lat = parseFloat(parts[2]);
      const latDir = parts[3];
      const lon = parseFloat(parts[4]);
      const lonDir = parts[5];
      const quality = parseInt(parts[6]);
      const satellites = parseInt(parts[7]);
      const hdop = parseFloat(parts[8]);
      const altitude = parseFloat(parts[9]);

      if (isNaN(lat) || isNaN(lon)) return null;

      // Convert NMEA coordinates to decimal degrees
      const latitude = (Math.floor(lat / 100) + (lat % 100) / 60) * (latDir === 'S' ? -1 : 1);
      const longitude = (Math.floor(lon / 100) + (lon % 100) / 60) * (lonDir === 'W' ? -1 : 1);

      return {
        latitude,
        longitude,
        altitude: altitude || 0,
        accuracy: hdop * 5 || 10, // Rough accuracy estimate from HDOP
        heading: 0,
        speed: 0,
        timestamp: Date.now(),
        source: 'usb-serial',
        satellites: satellites || 0,
        fix_quality: quality,
      };
    }

    // Handle RMC (Recommended Minimum)
    if (parts[0] === '$GPRMC' || parts[0] === '$GNRMC') {
      const status = parts[2];
      if (status !== 'A') return null; // A = valid, V = invalid

      const lat = parseFloat(parts[3]);
      const latDir = parts[4];
      const lon = parseFloat(parts[5]);
      const lonDir = parts[6];
      const speed = parseFloat(parts[7]); // knots
      const heading = parseFloat(parts[8]);

      if (isNaN(lat) || isNaN(lon)) return null;

      const latitude = (Math.floor(lat / 100) + (lat % 100) / 60) * (latDir === 'S' ? -1 : 1);
      const longitude = (Math.floor(lon / 100) + (lon % 100) / 60) * (lonDir === 'W' ? -1 : 1);

      return {
        latitude,
        longitude,
        altitude: 0,
        accuracy: 10,
        heading: heading || 0,
        speed: (speed || 0) * 0.514444, // Convert knots to m/s
        timestamp: Date.now(),
        source: 'usb-serial',
      };
    }

    return null;
  }, []);

  // Process incoming NMEA data
  const processData = useCallback((data: string) => {
    // Only log data in debug mode or when explicitly needed
    // console.log('[SerialGPS] Received data:', data.substring(0, 100));
    nmeaBufferRef.current += data;
    const sentences = nmeaBufferRef.current.split(/\r?\n/);
    nmeaBufferRef.current = sentences.pop() || ''; // Keep incomplete sentence

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed.startsWith('$')) continue;

      // Only log if it's a position sentence (GGA, RMC) or important status
      const isPositionSentence = trimmed.startsWith('$GPGGA') || trimmed.startsWith('$GNGGA') ||
                                 trimmed.startsWith('$GPRMC') || trimmed.startsWith('$GNRMC');
      
      const position = parseNMEA(trimmed);
      if (position) {
        console.log('[SerialGPS] ✓ Valid GPS fix received:', {
          lat: position.latitude.toFixed(6),
          lon: position.longitude.toFixed(6),
          satellites: position.satellites,
          accuracy: position.accuracy?.toFixed(1)
        });
        setState(prev => ({ ...prev, lastPosition: position }));
        optionsRef.current.onPosition?.(position);
      } else if (isPositionSentence) {
        // Only log position sentences that failed to parse (indicates waiting for fix)
        // But only occasionally to avoid spam
        if (Math.random() < 0.01) { // Log ~1% of failed attempts
          console.log('[SerialGPS] ⏳ Waiting for GPS fix...');
        }
      }
    }
  }, [parseNMEA]);

  // Read from serial port
  const startReading = useCallback(async (port: SerialPort) => {
    try {
      console.log('[SerialGPS] Starting to read from serial port');
      const reader = port.readable?.getReader();
      if (!reader) throw new Error('Could not get reader from port');
      
      readerRef.current = reader;
      const decoder = new TextDecoder();

      console.log('[SerialGPS] Reader obtained, beginning read loop');
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          console.log('[SerialGPS] Read completed (done=true)');
          break;
        }
        
        const text = decoder.decode(value);
        processData(text);
      }
    } catch (error: any) {
      if (error.name !== 'NetworkError') {
        console.error('Serial read error:', error);
        setState(prev => ({ ...prev, error: error.message }));
        optionsRef.current.onError?.(error);
      }
    }
  }, [processData]);

  // Connect to a serial port
  const connect = useCallback(async (port?: SerialPort) => {
    if (!isSupported()) {
      const error = new Error('Web Serial API not supported in this browser');
      setState(prev => ({ ...prev, error: error.message }));
      optionsRef.current.onError?.(error);
      return;
    }

    // If already connected to the same port, don't reconnect
    if (portRef.current && state.isConnected) {
      console.log('Already connected to a port');
      // If trying to connect to the same port, just return
      if (!port || port === portRef.current) {
        return;
      }
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      // If no port provided, request one from user
      const selectedPort = port || await navigator.serial.requestPort();
      
      // Check if port is already open
      if (!selectedPort.readable || !selectedPort.writable) {
        // Try common GPS baud rates in order of popularity
        const baudRates = [9600, 4800, 38400, 19200];
        let opened = false;
        
        for (const baudRate of baudRates) {
          try {
            console.log(`[SerialGPS] Attempting to open port at ${baudRate} baud`);
            await selectedPort.open({ 
              baudRate,
              dataBits: 8,
              stopBits: 1,
              parity: 'none',
              flowControl: 'none'
            });
            console.log(`[SerialGPS] Successfully opened port at ${baudRate} baud`);
            opened = true;
            break;
          } catch (err: any) {
            console.warn(`[SerialGPS] Failed to open at ${baudRate} baud:`, err.message);
            // If already open at different baud rate, that's OK
            if (err.message?.includes('already open')) {
              opened = true;
              break;
            }
          }
        }
        
        if (!opened) {
          throw new Error('Failed to open serial port at any supported baud rate');
        }
      } else {
        console.log('[SerialGPS] Port already open, reusing connection');
      }

      const info = selectedPort.getInfo();
      portRef.current = selectedPort;
      
      setState(prev => ({
        ...prev,
        isConnected: true,
        isConnecting: false,
        deviceInfo: {
          name: 'USB GPS Device',
          vendorId: info.usbVendorId,
          productId: info.usbProductId,
        },
      }));

      optionsRef.current.onConnect?.();
      
      // Start reading data
      startReading(selectedPort);
      
    } catch (error: any) {
      console.error('Serial connection error:', error);
      setState(prev => ({
        ...prev,
        isConnecting: false,
        isConnected: false,
        error: error.message,
      }));
      optionsRef.current.onError?.(error);
    }
  }, [isSupported, startReading, state.isConnected]);

  // Auto-detect and connect to saved USB device
  const autoConnect = useCallback(async () => {
    if (!isSupported()) return;

    try {
      const ports = await navigator.serial.getPorts();
      if (ports.length > 0) {
        console.log(`Found ${ports.length} saved USB serial device(s), connecting to first...`);
        await connect(ports[0]);
      }
    } catch (error) {
      console.warn('Auto-connect failed:', error);
    }
  }, [isSupported, connect]);

  // Get list of previously authorized ports
  const getAuthorizedPorts = useCallback(async () => {
    if (!isSupported()) return [];

    try {
      const ports = await navigator.serial.getPorts();
      return ports.map((port, index) => {
        const info = port.getInfo();
        return {
          port,
          name: `USB GPS Device ${index + 1}`,
          vendorId: info.usbVendorId,
          productId: info.usbProductId,
        };
      });
    } catch (error) {
      console.error('Error getting authorized ports:', error);
      return [];
    }
  }, [isSupported]);

  // Disconnect
  const disconnect = useCallback(async () => {
    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current.releaseLock();
        readerRef.current = null;
      }

      if (portRef.current) {
        await portRef.current.close();
        portRef.current = null;
      }

      setState({
        isConnected: false,
        isConnecting: false,
        deviceInfo: null,
        lastPosition: null,
        error: null,
      });

      optionsRef.current.onDisconnect?.();
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    ...state,
    isSupported: isSupported(),
    connect,
    autoConnect,
    disconnect,
    getAuthorizedPorts,
  };
}
