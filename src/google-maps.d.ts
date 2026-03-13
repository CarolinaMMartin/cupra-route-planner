/* eslint-disable @typescript-eslint/no-namespace */

// Minimal Google Maps type declarations for this project

declare namespace google.maps {
  class Map {
    constructor(element: HTMLElement, options?: MapOptions);
    fitBounds(bounds: LatLngBounds): void;
    setZoom(zoom: number): void;
    getZoom(): number | undefined;
    setCenter(center: LatLngLiteral): void;
  }

  class Marker {
    constructor(options?: MarkerOptions);
    setMap(map: Map | null): void;
    addListener(event: string, handler: () => void): MapsEventListener;
  }

  class InfoWindow {
    constructor(options?: { content?: string });
    open(map: Map, marker: Marker): void;
  }

  class LatLngBounds {
    constructor();
    extend(point: LatLngLiteral | LatLng): void;
  }

  class LatLng {
    constructor(lat: number, lng: number);
    lat(): number;
    lng(): number;
  }

  class Size {
    constructor(width: number, height: number);
  }

  class Point {
    constructor(x: number, y: number);
  }

  interface MapOptions {
    center?: LatLngLiteral;
    zoom?: number;
    mapTypeControl?: boolean;
    streetViewControl?: boolean;
    fullscreenControl?: boolean;
  }

  interface MarkerOptions {
    position?: LatLngLiteral;
    map?: Map;
    title?: string;
    icon?: Icon | string;
    animation?: number;
  }

  interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  interface Icon {
    url: string;
    scaledSize?: Size;
    anchor?: Point;
  }

  interface MapsEventListener {
    remove(): void;
  }

  namespace event {
    function addListener(instance: any, event: string, handler: (...args: any[]) => void): MapsEventListener;
    function addListenerOnce(instance: any, event: string, handler: (...args: any[]) => void): MapsEventListener;
    function removeListener(listener: MapsEventListener): void;
  }

  enum Animation {
    BOUNCE = 1,
    DROP = 2,
  }

  namespace places {
    class PlacesService {
      constructor(attrContainer: Map | HTMLElement);
      getDetails(
        request: { placeId: string; fields?: string[] },
        callback: (result: PlaceResult | null, status: PlacesServiceStatus) => void
      ): void;
    }

    interface PlaceResult {
      geometry?: {
        location?: LatLng;
      };
      name?: string;
      formatted_address?: string;
    }

    enum PlacesServiceStatus {
      OK = "OK",
      ZERO_RESULTS = "ZERO_RESULTS",
      ERROR = "ERROR",
    }
  }
}

interface Window {
  google: typeof google;
}
