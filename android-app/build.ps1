# Builds the Catalyst Android app (a Trusted Web Activity around the live portal).
#   powershell -File android-app\build.ps1
# Needs: the icons deployed at https://catalyst.umerfarooqsqa.workers.dev/icons/ (Bubblewrap downloads them),
# JDK 17+ and the Android SDK (paths below), and .keystore.env next to this script (signing passwords).
# Output: dist\catalyst-<version>.apk (install with adb) and dist\catalyst-<version>.aab (Play Store).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
foreach ($line in Get-Content ".keystore.env") {
  if ($line -match '^\s*([A-Z_]+)=(.*)$') { Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2] }
}
$jdk = if ($env:CATALYST_JDK) { $env:CATALYST_JDK } else { "C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot" }  # JDK 21: Android Studio's bundled JDK 25 is too new for the generated Gradle build
# Bubblewrap runs java/apksigner through the shell without quoting the JDK path, so a path with spaces
# ("C:\Program Files\...") breaks signing. Use the space-free short (8.3) form of the folder.
$jdk = (New-Object -ComObject Scripting.FileSystemObject).GetFolder($jdk).ShortPath
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
$cfgDir = Join-Path $HOME ".bubblewrap"
New-Item -ItemType Directory -Force $cfgDir | Out-Null
# Without a BOM: Windows PowerShell's "-Encoding utf8" adds one, and Bubblewrap then can't parse the file.
[IO.File]::WriteAllText((Join-Path $cfgDir "config.json"), (@{ jdkPath = $jdk; androidSdkPath = $sdk } | ConvertTo-Json),
  (New-Object System.Text.UTF8Encoding $false))

$m = Get-Content "twa-manifest.json" -Raw | ConvertFrom-Json
# Regenerate the Android project from twa-manifest.json, then build and sign it.
npx --yes @bubblewrap/cli@1.25.0 update --skipVersionUpgrade --manifest twa-manifest.json
if ($LASTEXITCODE -ne 0) { throw "bubblewrap update failed" }
# The generated build.gradle still lists jcenter(), which has shut down (dependency downloads fail).
(Get-Content "build.gradle" -Raw) -replace 'jcenter\(\)', 'mavenCentral()' |
  ForEach-Object { [IO.File]::WriteAllText((Join-Path $PSScriptRoot "build.gradle"), $_, (New-Object System.Text.UTF8Encoding $false)) }

# Bubblewrap runs "gradlew.bat" by bare name, which Windows won't take from the current folder.
$env:PATH = "$PSScriptRoot;$env:PATH"
$env:JAVA_HOME = $jdk
npx --yes @bubblewrap/cli@1.25.0 build --skipPwaValidation --manifest twa-manifest.json
if ($LASTEXITCODE -ne 0) { throw "bubblewrap build failed" }

New-Item -ItemType Directory -Force "dist" | Out-Null
Copy-Item "app-release-signed.apk" "dist\catalyst-$($m.appVersionName).apk" -Force
Copy-Item "app-release-bundle.aab" "dist\catalyst-$($m.appVersionName).aab" -Force
Write-Host "Built dist\catalyst-$($m.appVersionName).apk"

# Publish it on the site's /download page: the APK at a fixed URL, plus the version info the page shows.
# (Deploy catalyst afterwards for the new file to go live.)
$pub = Join-Path $PSScriptRoot "..\public\downloads"
New-Item -ItemType Directory -Force $pub | Out-Null
$apk = Join-Path $pub "catalyst-android.apk"
Copy-Item "dist\catalyst-$($m.appVersionName).apk" $apk -Force
$info = [ordered]@{
  version     = $m.appVersionName
  versionCode = $m.appVersionCode
  sizeBytes   = (Get-Item $apk).Length
  sha256      = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLower()
  url         = "/downloads/catalyst-android.apk"
}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "..\lib\android-app.json"), ($info | ConvertTo-Json),
  (New-Object System.Text.UTF8Encoding $false))
Write-Host "Published to public\downloads\catalyst-android.apk (deploy catalyst to put it live)"
