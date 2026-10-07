import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { SegmentedControl } from "../../components/SegmentedControl";
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
  return { kind: "custom-headers", headers: auth.headers };
}

export function serviceAuthFromDraft(
  draft: EnvironmentServiceAuthDraft,
): EnvironmentServiceAuth | null {
  return draft.kind === "none" ? null : makeCustomHeadersServiceAuth(draft.headers);
}

const AUTH_OPTIONS = [
  { value: "none", label: "None" },
  { value: "custom-headers", label: "Custom" },
] satisfies ReadonlyArray<{ value: EnvironmentServiceAuthDraft["kind"]; label: string }>;

export function EnvironmentServiceAuthFields(props: {
  readonly value: EnvironmentServiceAuthDraft;
  readonly onChange: (value: EnvironmentServiceAuthDraft) => void;
}) {
  const headers = props.value.kind === "custom-headers" ? props.value.headers : [];
  const updateCustomHeader = (index: number, field: "name" | "value", value: string): void => {
    props.onChange({
      kind: "custom-headers",
      headers: headers.map((header, candidateIndex) =>
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
        <SegmentedControl
          options={AUTH_OPTIONS}
          selected={props.value.kind}
          onSelect={(kind) =>
            props.onChange(
              kind === "none"
                ? EMPTY_SERVICE_AUTH_DRAFT
                : {
                    kind,
                    headers: [{ name: "", value: "" }],
                  },
            )
          }
        />
      </View>

      {props.value.kind === "custom-headers" ? (
        <>
          <Text className="text-xs leading-normal text-foreground-muted">
            Sends headers only to this environment's HTTPS origin. Stores values securely on this
            device.
          </Text>
          {headers.map((header, index) => (
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
                    const remaining = headers.filter(
                      (_, candidateIndex) => candidateIndex !== index,
                    );
                    props.onChange({
                      kind: "custom-headers",
                      headers: remaining.length === 0 ? [{ name: "", value: "" }] : remaining,
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
              props.onChange({
                kind: "custom-headers",
                headers: [...headers, { name: "", value: "" }],
              });
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
