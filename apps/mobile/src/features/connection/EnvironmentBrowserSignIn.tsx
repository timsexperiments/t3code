import { useState } from "react";
import { Platform, View } from "react-native";
import { WebView } from "react-native-webview";
import { requireNativeModule } from "expo";
import * as Schema from "effect/Schema";
import { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { AppText } from "../../components/ui/AppText";

const session = requireNativeModule<{
  updateBrowserSession(origin: string, clear: boolean): Promise<void>;
}>("T3NativeControls");

const decodeEnvironment = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);

function environmentOrigin(address: string) {
  try {
    const url = new URL(address);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

async function verifyEnvironment(origin: string) {
  await session.updateBrowserSession(origin, false);
  const response = await fetch(`${origin}/.well-known/t3/environment`, {
    credentials: "include",
    redirect: "error",
  });
  if (!response.ok) throw new Error("Complete sign-in before continuing.");
  decodeEnvironment(await response.json());
}

export function EnvironmentBrowserSignIn(props: {
  readonly address: string;
  readonly onSignedIn?: () => void;
}) {
  const origin = environmentOrigin(props.address);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (origin === null || Platform.OS !== "ios") return null;

  const verify = () => {
    setBusy(true);
    setError(null);
    void verifyEnvironment(origin)
      .then(() => {
        setOpen(false);
        props.onSignedIn?.();
      })
      .catch(() =>
        setError("The environment is not reachable yet. Complete sign-in, then try again."),
      )
      .finally(() => setBusy(false));
  };

  return (
    <View className="gap-2">
      <Button label="Sign in to environment" onPress={() => setOpen(true)} />
      {open ? (
        <Sheet title="Environment sign-in" onClose={() => setOpen(false)}>
          <View className="flex-1">
            <View className="gap-2 px-4 pb-3 pt-16">
              <AppText selectable>{origin}</AppText>
              <AppText>
                Signing out also clears cookies shared with other environments on this domain.
              </AppText>
              {error ? <ErrorBanner message={error} /> : null}
              <View className="flex-row gap-2">
                <Button label="Continue" loading={busy} onPress={() => void verify()} />
                <Button
                  label="Sign out"
                  disabled={busy}
                  onPress={() => {
                    setBusy(true);
                    void session
                      .updateBrowserSession(origin, true)
                      .then(() => setOpen(false))
                      .catch(() => setError("Could not clear this browser session."))
                      .finally(() => setBusy(false));
                  }}
                />
              </View>
            </View>
            <WebView
              source={{ uri: origin }}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              style={{ flex: 1 }}
            />
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}
