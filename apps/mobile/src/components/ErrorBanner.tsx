import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "./AppText";
export function ErrorBanner(props: { readonly message: string; readonly children?: ReactNode }) {
  return (
    <View className="gap-2 rounded-2xl border border-danger-border bg-danger px-3.5 py-3">
      <Text className="font-t3-medium text-sm text-danger-foreground">{props.message}</Text>
      {props.children}
    </View>
  );
}
