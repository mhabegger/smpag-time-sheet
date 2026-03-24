# Windows OCR via WinRT - batch process screenshot images
# Usage: powershell -File ocr.ps1 -ImagePaths "path1.jpg|path2.jpg|..."
# Output: JSON array of {path, text, error} objects

param(
    [Parameter(Mandatory=$true)]
    [string]$ImagePaths
)

# Load WinRT types
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]

# Helper to await WinRT async operations
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}

# Create OCR engine once
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {
    Write-Output '[{"path":"","text":"","error":"Failed to create OCR engine"}]'
    exit 1
}

$paths = $ImagePaths -split '\|'
$results = @()

foreach ($imagePath in $paths) {
    $imagePath = $imagePath.Trim()
    if (-not $imagePath) { continue }

    try {
        $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
        $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $ocrResult = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

        # Sanitize OCR text: replace control characters that break JSON
        $cleanText = $ocrResult.Text -replace '[^\x20-\x7E\xA0-\xFF]', ' '

        $results += @{
            path = $imagePath
            text = $cleanText
            error = $null
        }

        $stream.Dispose()
        $bitmap.Dispose()
    }
    catch {
        $results += @{
            path = $imagePath
            text = ""
            error = $_.Exception.Message
        }
    }
}

# Output as JSON
$results | ConvertTo-Json -Compress -Depth 3
