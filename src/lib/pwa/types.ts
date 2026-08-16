// A device family's logical viewport plus its pixel ratio. The PNG iOS expects
// is `width * dpr` by `height * dpr`.
export interface SplashDevice {
  width: number;
  height: number;
  dpr: number;
}

// One <link rel="apple-touch-startup-image"> worth of data.
export interface SplashImage {
  href: string;
  media: string;
}
