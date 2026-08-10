export interface ClientConfig {
  /** Hot-seat privacy curtain interposed whenever priority changes hands. */
  passDeviceScreen: boolean;
  /**
   * Where `cardImageSrc` looks for card art, with no trailing slash.
   *
   * `/cards` is `public/cards/`, the gitignored local cache Vite serves
   * verbatim. One constant on purpose: serving the art from anywhere else is a
   * change of origin, not a change of code.
   */
  cardImageBase: string;
}

export const config: ClientConfig = { passDeviceScreen: false, cardImageBase: '/cards' };
