import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  DEFAULT_VIBES,
  generateDiscoverySession,
  SpotifyClient,
  type DiscoverySession,
} from "@melora/core";

/**
 * Mobile shell — uses the same @melora/core discovery engine as web/desktop.
 * Wire up Expo AuthSession + SecureStore next for full Spotify login on device.
 */
export default function HomeScreen() {
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<DiscoverySession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(
    () =>
      new SpotifyClient({
        getAccessToken: () => null,
      }),
    [],
  );

  const loadDemoState = useCallback(() => {
    setError(
      "Connect Spotify on mobile via Expo AuthSession (see README). Web app is ready today.",
    );
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await generateDiscoverySession(client, {
        cadence: "hourly",
        limit: 12,
      });
      setSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load picks");
    } finally {
      setLoading(false);
    }
  }, [client]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>Melora Mobile</Text>
      <Text style={styles.title}>Shared discovery core</Text>
      <Text style={styles.body}>
        This Expo app imports the same recommendation, vibe, BPM, and sorting logic from
        `@melora/core`. Add Spotify login here to mirror the web experience on iOS/Android.
      </Text>

      <View style={styles.row}>
        <Pressable style={styles.button} onPress={loadDemoState}>
          <Text style={styles.buttonText}>Setup note</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondary]} onPress={() => void refresh()}>
          <Text style={styles.buttonText}>Try API call</Text>
        </Pressable>
      </View>

      {loading && <ActivityIndicator color="#1ed760" style={{ marginTop: 16 }} />}
      {error && <Text style={styles.error}>{error}</Text>}

      {session && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Session ready</Text>
          <Text style={styles.body}>{session.tracks.length} tracks • {session.cadence}</Text>
          <Text style={styles.body}>Vibes available: {DEFAULT_VIBES.length}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: "#0b0f14",
    minHeight: "100%",
  },
  eyebrow: {
    color: "#1ed760",
    textTransform: "uppercase",
    letterSpacing: 2,
    marginBottom: 8,
  },
  title: {
    color: "#eef3f8",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
  },
  body: {
    color: "#93a1b3",
    lineHeight: 22,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  button: {
    backgroundColor: "#1ed760",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  secondary: {
    backgroundColor: "#182030",
  },
  buttonText: {
    color: "#041109",
    fontWeight: "700",
  },
  error: {
    color: "#ff6b6b",
    marginTop: 16,
  },
  card: {
    marginTop: 20,
    backgroundColor: "#121821",
    borderRadius: 16,
    padding: 16,
  },
  cardTitle: {
    color: "#eef3f8",
    fontWeight: "700",
    marginBottom: 6,
  },
});
