# ⚠️ CRITICAL BUILD WARNING

## DO NOT USE EAS BUILD FOR PRODUCTION

Trinity MUST be compiled using the traditional React Native method with Gradle directly.

### ❌ WRONG (Will Fail)
```bash
eas build --platform android --profile production
```

### ✅ CORRECT
```bash
cd android
./gradlew bundleRelease -PreactNativeArchitectures=arm64-v8a
```

## Why?

- **EAS Build generates its own keystore** automatically
- **Google Play Store requires the same keystore** for all app updates
- Using EAS will result in **"incorrect signing key" error** when uploading to Play Store
- Our production keystore has specific SHA fingerprints registered with Google

## Production Keystore

- **File**: `android/app/trinity-release-key.keystore`
- **SHA1**: `5E:91:A9:4E:3C:5A:2F:0D:0D:BF:CD:E0:8D:47:43:F7:43:8F:AE:24`
- **SHA256**: `56:CF:A1:1B:79:1B:36:A5:4D:F5:17:18:FA:E8:D9:A2:FE:F9:8E:5E:2A:C7:75:8C:6E:9D:2A:F2:B8:1E:6A:97`

## Build Output

The AAB will be generated at:
```
android/app/build/outputs/bundle/release/app-release.aab
```

## If You Lost the Keystore

See `docs/KEYSTORE_INFO.md` for instructions on requesting a key reset from Google Play Console.

---

**Last Updated**: 2026-03-10
**Last Key Change**: 2026-03-12
