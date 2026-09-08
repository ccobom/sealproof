Add-Type -AssemblyName System.Drawing

$outputPath = Join-Path $PSScriptRoot "..\src\spike\fixtures\synthetic-photo.jpg"
$outputPath = [System.IO.Path]::GetFullPath($outputPath)
$expectedRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\src\spike\fixtures"))

if (-not $outputPath.StartsWith($expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside the spike fixture directory."
}

[System.IO.Directory]::CreateDirectory($expectedRoot) | Out-Null
$bitmap = [System.Drawing.Bitmap]::new(1280, 960)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

try {
    $graphics.Clear([System.Drawing.Color]::FromArgb(224, 234, 239))
    $graphics.FillRectangle(
        [System.Drawing.Brushes]::SteelBlue,
        [System.Drawing.Rectangle]::new(240, 560, 800, 400)
    )
    $graphics.FillEllipse(
        [System.Drawing.Brushes]::BurlyWood,
        [System.Drawing.Rectangle]::new(440, 150, 400, 400)
    )
    $font = [System.Drawing.Font]::new("Arial", 64, [System.Drawing.FontStyle]::Bold)
    try {
        $graphics.DrawString(
            "SYNTHETIC TEST IMAGE",
            $font,
            [System.Drawing.Brushes]::DarkSlateGray,
            [System.Drawing.PointF]::new(210, 40)
        )
    }
    finally {
        $font.Dispose()
    }

    $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
        Where-Object MimeType -eq "image/jpeg"
    $quality = [System.Drawing.Imaging.Encoder]::Quality
    $parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
    try {
        $parameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new($quality, 80L)
        $bitmap.Save($outputPath, $jpegCodec, $parameters)
    }
    finally {
        $parameters.Dispose()
    }
}
finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}

Write-Output "Generated $outputPath"
