export interface ClientConfig {
  /** Hot-seat privacy curtain interposed whenever priority changes hands. */
  passDeviceScreen: boolean;
}

export const config: ClientConfig = { passDeviceScreen: false };
