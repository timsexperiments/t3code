import { useEffect, useEffectEvent } from "react";
import { Image, type ImageProps } from "react-native";
import { Image as ExpoImage, type ImageProps as ExpoImageProps } from "expo-image";

import { useEnvironmentMediaUri } from "../lib/environmentMedia";

/** Network images use the same authenticated, redirect-safe asset transport as file previews. */
export function EnvironmentImage(
  props: Omit<ImageProps, "source"> & {
    readonly uri: string;
    readonly onTransportError?: () => void;
  },
) {
  const { uri, onTransportError, ...imageProps } = props;
  const media = useEnvironmentMediaUri(uri);
  const fail = useEffectEvent(() => onTransportError?.());
  useEffect(() => {
    if (media.error) fail();
  }, [media.error]);
  return <Image {...imageProps} source={media.uri === null ? undefined : { uri: media.uri }} />;
}

export function EnvironmentExpoImage(
  props: Omit<ExpoImageProps, "source"> & {
    readonly uri: string;
    readonly cacheKey?: string | null;
    readonly onTransportError?: () => void;
  },
) {
  const { uri, cacheKey, onTransportError, ...imageProps } = props;
  const media = useEnvironmentMediaUri(uri);
  const fail = useEffectEvent(() => onTransportError?.());
  useEffect(() => {
    if (media.error) fail();
  }, [media.error]);
  return (
    <ExpoImage
      {...imageProps}
      source={
        media.uri === null ? undefined : { uri: media.uri, ...(cacheKey ? { cacheKey } : {}) }
      }
    />
  );
}
