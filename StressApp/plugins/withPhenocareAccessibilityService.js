// Expo config plugin that reapplies the hand-written "PhenoCare Sensor"
// native wiring (KeystrokeCollectorService.java, an AccessibilityService)
// every time `expo prebuild` runs. Without this, prebuild regenerates
// AndroidManifest.xml / MainApplication.kt / strings.xml / app/build.gradle
// from Expo's vanilla templates and silently drops the <service> entry,
// package registration, string resource and gradle dependency this feature
// needs -- which is exactly what made "PhenoCare Sensor" disappear from
// Settings > Accessibility in a past build (see git history around commits
// 4c8bccc / e504630, and the header comment in KeystrokeCollectorService.java).
//
// This plugin intentionally does NOT own the native .java source files
// themselves (android/app/src/main/java/.../phenotyping/*.java) -- those
// are hand-maintained in place and already survive a normal (non --clean)
// prebuild since Expo doesn't know about or touch arbitrary source files.
// It only reapplies the four templated files prebuild regenerates, plus
// defensively restores accessibility_service_config.xml (a custom resource
// prebuild also doesn't manage) and warns loudly if the .java sources are
// ever missing (e.g. after a full `expo prebuild --clean`).
const {
    AndroidConfig,
    withAndroidManifest,
    withStringsXml,
    withMainApplication,
    withAppBuildGradle,
    withDangerousMod,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE = 'com.mindpulse.stressapp.phenotyping';
const SERVICE_CLASS = `${PACKAGE}.KeystrokeCollectorService`;
const BOOT_RECEIVER_CLASS = `${PACKAGE}.BootReceiver`;
const EMA_RECEIVER_CLASS = `${PACKAGE}.EmaNotificationReceiver`;
const SPECIAL_USE_PERMISSION = 'android.permission.FOREGROUND_SERVICE_SPECIAL_USE';

const ACCESSIBILITY_DESCRIPTION =
    'Passively tracks typing pace, scroll velocity and app switching to detect stress patterns -- no text content is ever recorded.';

const REQUIRED_JAVA_FILES = [
    'KeystrokeCollectorService.java',
    'PhenotypingIdentityModule.java',
    'PhenotypingPackage.java',
    'BootReceiver.java',
    'EmaNotificationReceiver.java',
    'EmaNotificationScheduler.java',
];

function withPhenocareManifest(config) {
    return withAndroidManifest(config, (config) => {
        const manifest = config.modResults.manifest;
        const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);

        manifest['uses-permission'] = manifest['uses-permission'] || [];
        if (!manifest['uses-permission'].some((p) => p.$['android:name'] === SPECIAL_USE_PERMISSION)) {
            manifest['uses-permission'].push({ $: { 'android:name': SPECIAL_USE_PERMISSION } });
        }

        app.service = app.service || [];
        if (!app.service.some((s) => s.$['android:name'] === SERVICE_CLASS)) {
            app.service.push({
                $: {
                    'android:name': SERVICE_CLASS,
                    'android:label': 'PhenoCare Sensor',
                    'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
                    'android:exported': 'true',
                    'android:foregroundServiceType': 'specialUse',
                },
                'intent-filter': [
                    { action: [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }] },
                ],
                'meta-data': [
                    {
                        $: {
                            'android:name': 'android.accessibilityservice',
                            'android:resource': '@xml/accessibility_service_config',
                        },
                    },
                ],
                property: [
                    {
                        $: {
                            'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
                            'android:value':
                                'Passive behavioral stress-monitoring research sensor -- keystroke timing, scroll velocity and app-switch rate only, no text content is ever read.',
                        },
                    },
                ],
            });
        }

        app.receiver = app.receiver || [];
        if (!app.receiver.some((r) => r.$['android:name'] === BOOT_RECEIVER_CLASS)) {
            app.receiver.push({
                $: { 'android:name': BOOT_RECEIVER_CLASS, 'android:exported': 'true' },
                'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } }] }],
            });
        }
        if (!app.receiver.some((r) => r.$['android:name'] === EMA_RECEIVER_CLASS)) {
            app.receiver.push({
                $: { 'android:name': EMA_RECEIVER_CLASS, 'android:exported': 'false' },
            });
        }

        return config;
    });
}

function withPhenocareStrings(config) {
    return withStringsXml(config, (config) => {
        config.modResults = AndroidConfig.Strings.setStringItem(
            [{ $: { name: 'phenotyping_accessibility_description' }, _: ACCESSIBILITY_DESCRIPTION }],
            config.modResults
        );
        return config;
    });
}

function withPhenocareMainApplication(config) {
    return withMainApplication(config, (config) => {
        let contents = config.modResults.contents;
        const importLine = `import ${PACKAGE}.PhenotypingPackage`;

        if (!contents.includes(importLine)) {
            const lines = contents.split('\n');
            let lastImportIdx = -1;
            lines.forEach((line, i) => {
                if (line.trim().startsWith('import ')) lastImportIdx = i;
            });
            if (lastImportIdx >= 0) {
                lines.splice(lastImportIdx + 1, 0, importLine);
                contents = lines.join('\n');
            } else {
                contents = `${importLine}\n${contents}`;
            }
        }

        if (!contents.includes('add(PhenotypingPackage())')) {
            contents = contents.replace(
                /(PackageList\(this\)\.packages\.apply\s*\{)/,
                `$1\n              add(PhenotypingPackage())`
            );
        }

        config.modResults.contents = contents;
        return config;
    });
}

function withPhenocareBuildGradle(config) {
    return withAppBuildGradle(config, (config) => {
        let contents = config.modResults.contents;
        const dep = "implementation 'com.google.android.gms:play-services-location:21.3.0'";
        if (!contents.includes('com.google.android.gms:play-services-location')) {
            contents = contents.replace(/(dependencies\s*\{)/, `$1\n    ${dep}`);
        }
        config.modResults.contents = contents;
        return config;
    });
}

function withPhenocareResources(config) {
    return withDangerousMod(config, [
        'android',
        async (config) => {
            const platformRoot = config.modRequest.platformProjectRoot;

            // accessibility_service_config.xml -- a custom resource file
            // prebuild doesn't manage at all, so a full `expo prebuild
            // --clean` (which wipes android/ before regenerating) would
            // drop it silently without this.
            const xmlDir = path.join(platformRoot, 'app/src/main/res/xml');
            const xmlDest = path.join(xmlDir, 'accessibility_service_config.xml');
            const xmlSrc = path.join(__dirname, 'phenocare-native/accessibility_service_config.xml');
            fs.mkdirSync(xmlDir, { recursive: true });
            fs.copyFileSync(xmlSrc, xmlDest);

            // The phenotyping/*.java sources are hand-written in place, not
            // generated by this plugin -- just warn loudly if they're ever
            // missing instead of silently shipping a build with no
            // accessibility service at all.
            const javaDir = path.join(platformRoot, 'app/src/main/java/com/mindpulse/stressapp/phenotyping');
            const missing = REQUIRED_JAVA_FILES.filter((f) => !fs.existsSync(path.join(javaDir, f)));
            if (missing.length > 0) {
                console.warn(
                    '\n⚠️  [withPhenocareAccessibilityService] Missing native source files -- ' +
                        'the PhenoCare accessibility service will NOT be built:\n' +
                        missing
                            .map((f) => `   - android/app/src/main/java/com/mindpulse/stressapp/phenotyping/${f}`)
                            .join('\n') +
                        '\nRestore them with:\n' +
                        '   git checkout -- StressApp/android/app/src/main/java/com/mindpulse/stressapp/phenotyping/\n'
                );
            }

            return config;
        },
    ]);
}

module.exports = function withPhenocareAccessibilityService(config) {
    config = withPhenocareManifest(config);
    config = withPhenocareStrings(config);
    config = withPhenocareMainApplication(config);
    config = withPhenocareBuildGradle(config);
    config = withPhenocareResources(config);
    return config;
};
