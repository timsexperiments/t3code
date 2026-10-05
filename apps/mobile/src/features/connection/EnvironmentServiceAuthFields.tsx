import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { ConnectionFormField } from "./ConnectionFormField";
import {
  makeCustomHeadersServiceAuth,
  type EnvironmentServiceAuth,
} from "../../persistence/environment-service-auth";

export type EnvironmentServiceAuthDraft =
  | { readonly kind: "none" }
  | {
      readonly kind: "custom-headers";
      readonly headers: ReadonlyArray<{ readonly name: string; readonly value: string }>;
    };

export const EMPTY_SERVICE_AUTH_DRAFT: EnvironmentServiceAuthDraft = Object.freeze({
  kind: "none",
});

export function serviceAuthDraftFromStored(
  auth: EnvironmentServiceAuth | null,
): EnvironmentServiceAuthDraft {
  if (auth === null) {
    return EMPTY_SERVICE_AUTH_DRAFT;
  }
  switch (auth._tag) {
    case "CustomHeadersServiceAuth":
      return {
        kind: "custom-headers",
        headers: auth.headers.map((header) => ({ name: header.name, value: header.value })),
      };
  }
}

export function serviceAuthFromDraft(
  draft: EnvironmentServiceAuthDraft,
): EnvironmentServiceAuth | null {
  switch (draft.kind) {
    case "none":
      return null;
    case "custom-headers":
      return makeCustomHeadersServiceAuth(draft.headers);
  }
}

const AUTH_OPTIONS: ReadonlyArray<{
  readonly kind: EnvironmentServiceAuthDraft["kind"];
  readonly label: string;
}> = [
  { kind: "none", label: "None" },
  { kind: "custom-headers", label: "Custom" },
];

function draftForKind(kind: EnvironmentServiceAuthDraft["kind"]): EnvironmentServiceAuthDraft {
  switch (kind) {
    case "none":
      return EMPTY_SERVICE_AUTH_DRAFT;
    case "custom-headers":
      return { kind, headers: [{ name: "", value: "" }] };
  }
}

export function EnvironmentServiceAuthFields(props: {
  readonly value: EnvironmentServiceAuthDraft;
  readonly onChange: (value: EnvironmentServiceAuthDraft) => void;
}) {
  const updateCustomHeader = (index: number, field: "name" | "value", value: string): void => {
    if (props.value.kind !== "custom-headers") {
      return;
    }
    props.onChange({
      kind: "custom-headers",
      headers: props.value.headers.map((header, candidateIndex) =>
        candidateIndex === index ? { ...header, [field]: value } : header,
      ),
    });
  };

  return (
    <View collapsable={false} className="gap-3">
      <View className="gap-1.5">
        <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
          Service authentication
        </Text>
        <View className="flex-row gap-2">
          {AUTH_OPTIONS.map((option) => {
            const selected = props.value.kind === option.kind;
            return (
              <Pressable
                key={option.kind}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                className={cn(
                  "min-h-[40px] flex-1 items-center justify-center rounded-[12px] border px-2 py-2 active:opacity-70",
                  selected ? "border-primary bg-primary" : "border-input-border bg-input",
                )}
                onPress={() => props.onChange(draftForKind(option.kind))}
              >
                <Text
                  className={cn(
                    "text-xs font-t3-bold",
                    selected ? "text-primary-foreground" : "text-foreground",
                  )}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {props.value.kind === "custom-headers" ? (
        <>
          <Text className="text-xs leading-normal text-foreground-muted">
            Sends these headers only to this environment’s HTTPS origin. Values are stored in the
            device keychain.
          </Text>
          {props.value.headers.map((header, index) => (
            <View
              key={`service-header-${String(index)}`}
              className="gap-2 rounded-[14px] bg-subtle p-3"
            >
              <ConnectionFormField
                label="Header name"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Authorization"
                value={header.name}
                onChangeText={(value) => updateCustomHeader(index, "name", value)}
              />
              <View className="flex-row items-end gap-2">
                <ConnectionFormField
                  className="flex-1"
                  label="Header value"
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  value={header.value}
                  onChangeText={(value) => updateCustomHeader(index, "value", value)}
                />
                <Pressable
                  accessibilityLabel={`Remove service header ${String(index + 1)}`}
                  className="h-[48px] w-[48px] items-center justify-center rounded-[14px] border border-danger-border bg-danger active:opacity-70"
                  onPress={() => {
                    if (props.value.kind !== "custom-headers") {
                      return;
                    }
                    const headers = props.value.headers.filter(
                      (_, candidateIndex) => candidateIndex !== index,
                    );
                    props.onChange({
                      kind: "custom-headers",
                      headers: headers.length === 0 ? [{ name: "", value: "" }] : headers,
                    });
                  }}
                >
                  <SymbolView
                    name="trash"
                    size={14}
                    tintColorClassName="accent-danger-foreground"
                    type="monochrome"
                  />
                </Pressable>
              </View>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            className="min-h-[42px] flex-row items-center justify-center gap-2 rounded-[14px] border border-input-border bg-input px-3 py-2 active:opacity-70"
            onPress={() => {
              if (props.value.kind === "custom-headers") {
                props.onChange({
                  kind: "custom-headers",
                  headers: [...props.value.headers, { name: "", value: "" }],
                });
              }
            }}
          >
            <SymbolView
              name="plus"
              size={13}
              tintColorClassName="accent-icon-subtle"
              type="monochrome"
            />
            <Text className="text-xs font-t3-bold tracking-[0.8px] uppercase text-foreground">
              Add header
            </Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
