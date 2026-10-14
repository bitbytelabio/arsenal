/**
 * tests/apk-inspect.test.ts
 * Tests in-process APK inspection engine (src/core/apk-inspect.ts)
 */

import { describe, expect, it } from "bun:test";
import { zipSync } from "fflate";
import { inspectApkInProcess, parseAxmlStrings, extractManifestMetadata } from "../src/core/apk-inspect.ts";
import { sha256Bytes } from "../src/core/hash.ts";

describe("In-Process APK Inspector", () => {
  it("rejects corrupted zip files with clear error", () => {
    const corrupt = new Uint8Array([0, 1, 2, 3, 4, 5]);
    expect(() => inspectApkInProcess(corrupt)).toThrow("Failed to parse APK archive");
  });

  it("rejects zip archive missing AndroidManifest.xml", () => {
    const noManifestZip = zipSync({
      "res/values/strings.xml": new TextEncoder().encode("<resources/>"),
    });
    expect(() => inspectApkInProcess(noManifestZip)).toThrow("Invalid APK: archive does not contain AndroidManifest.xml");
  });

  it("inspects standard APK with text manifest, components, permissions and certificates", () => {
    const manifestXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="io.bitbytelab.arsenal.demo"
    android:versionCode="1"
    android:versionName="1.0">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <application
        android:debuggable="true"
        android:label="DemoApp">
        <activity android:name="io.bitbytelab.arsenal.MainActivity" />
        <service android:name="io.bitbytelab.arsenal.SyncService" />
        <receiver android:name="io.bitbytelab.arsenal.BootReceiver" />
        <provider android:name="io.bitbytelab.arsenal.DataProvider" />
    </application>
</manifest>`;

    const mockApk = zipSync({
      "AndroidManifest.xml": new TextEncoder().encode(manifestXml),
      "classes.dex": new Uint8Array([0x64, 0x65, 0x78, 0x0a]),
      "classes2.dex": new Uint8Array([0x64, 0x65, 0x78, 0x0a]),
      "META-INF/CERT.RSA": new Uint8Array([0x30, 0x82, 0x01]),
      "META-INF/MANIFEST.MF": new Uint8Array([0x4d, 0x61, 0x6e]),
      "lib/arm64-v8a/libnative.so": new Uint8Array([0x7f, 0x45, 0x4c, 0x46]),
      "lib/x86_64/libnative.so": new Uint8Array([0x7f, 0x45, 0x4c, 0x46]),
      "res/drawable/icon.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });

    const result = inspectApkInProcess(mockApk);

    expect(result.packageName).toBe("io.bitbytelab.arsenal.demo");
    expect(result.debuggable).toBe(true);
    expect(result.permissions).toEqual([
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.INTERNET",
    ]);
    expect(result.components.activities).toContain("io.bitbytelab.arsenal.MainActivity");
    expect(result.components.services).toContain("io.bitbytelab.arsenal.SyncService");
    expect(result.components.receivers).toContain("io.bitbytelab.arsenal.BootReceiver");
    expect(result.components.providers).toContain("io.bitbytelab.arsenal.DataProvider");
    expect(result.hasCertificates).toBe(true);
    expect(result.certificateFiles).toEqual(["META-INF/CERT.RSA"]);
    expect(result.dexFiles).toEqual(["classes.dex", "classes2.dex"]);
    expect(result.nativeArchitectures).toEqual(["arm64-v8a", "x86_64"]);
    expect(result.totalFiles).toBe(8);
    expect(result.byteLength).toBe(mockApk.byteLength);
    expect(result.sha256).toBe(sha256Bytes(mockApk));
  });

  it("handles parseAxmlStrings gracefully on non-AXML buffers", () => {
    const rawText = new TextEncoder().encode("<manifest></manifest>");
    expect(parseAxmlStrings(rawText)).toBeNull();
  });
});
