#!/usr/bin/env pwsh

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repoRoot 'public\app-logo.png'
$androidResRoot = Join-Path $repoRoot 'android\app\src\main\res'

if (-not (Test-Path $sourcePath)) {
    throw "Android app icon source not found: $sourcePath"
}

if (-not (Test-Path $androidResRoot)) {
    throw "Android resources directory not found: $androidResRoot"
}

Add-Type -AssemblyName System.Drawing

function Get-ImageDimensions {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $image = [System.Drawing.Image]::FromFile($Path)
    try {
        return @{ Width = $image.Width; Height = $image.Height }
    }
    finally {
        $image.Dispose()
    }
}

function Save-SolidPng {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Width,
        [Parameter(Mandatory = $true)]
        [int]$Height,
        [Parameter(Mandatory = $true)]
        [System.Drawing.Color]$Color,
        [Parameter(Mandatory = $true)]
        [string]$TargetPath
    )

    $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear($Color)
        }
        finally {
            $graphics.Dispose()
        }

        $bitmap.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $bitmap.Dispose()
    }
}

function Save-ContainedPng {
    param(
        [Parameter(Mandatory = $true)]
        [System.Drawing.Image]$SourceImage,
        [Parameter(Mandatory = $true)]
        [int]$Width,
        [Parameter(Mandatory = $true)]
        [int]$Height,
        [Parameter(Mandatory = $true)]
        [System.Drawing.Color]$BackgroundColor,
        [Parameter(Mandatory = $true)]
        [string]$TargetPath,
        [double]$ContentScale = 0.96
    )

    $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear($BackgroundColor)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

            $usableWidth = $Width * $ContentScale
            $usableHeight = $Height * $ContentScale
            $ratio = [Math]::Min($usableWidth / $SourceImage.Width, $usableHeight / $SourceImage.Height)
            $drawWidth = [int][Math]::Round($SourceImage.Width * $ratio)
            $drawHeight = [int][Math]::Round($SourceImage.Height * $ratio)
            $offsetX = [int][Math]::Round(($Width - $drawWidth) / 2)
            $offsetY = [int][Math]::Round(($Height - $drawHeight) / 2)

            $destinationRect = New-Object System.Drawing.Rectangle($offsetX, $offsetY, $drawWidth, $drawHeight)
            $graphics.DrawImage($SourceImage, $destinationRect)
        }
        finally {
            $graphics.Dispose()
        }

        $bitmap.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $bitmap.Dispose()
    }
}

$targetFiles = Get-ChildItem -Path $androidResRoot -Recurse -Filter 'ic_launcher*.png' | Sort-Object FullName
if ($targetFiles.Count -eq 0) {
    throw "No Android launcher PNGs found under $androidResRoot"
}

$white = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
$transparent = [System.Drawing.Color]::FromArgb(0, 255, 255, 255)

$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
try {
    foreach ($targetFile in $targetFiles) {
        $dimensions = Get-ImageDimensions -Path $targetFile.FullName
        switch ($targetFile.Name) {
            'ic_launcher_background.png' {
                Save-SolidPng -Width $dimensions.Width -Height $dimensions.Height -Color $white -TargetPath $targetFile.FullName
            }
            'ic_launcher_foreground.png' {
                Save-ContainedPng -SourceImage $sourceImage -Width $dimensions.Width -Height $dimensions.Height -BackgroundColor $transparent -TargetPath $targetFile.FullName
            }
            default {
                Save-ContainedPng -SourceImage $sourceImage -Width $dimensions.Width -Height $dimensions.Height -BackgroundColor $white -TargetPath $targetFile.FullName
            }
        }

        Write-Host "Updated Android icon asset: $($targetFile.FullName.Replace($repoRoot + '\\', ''))" -ForegroundColor Gray
    }
}
finally {
    $sourceImage.Dispose()
}

Write-Host 'Android launcher icons synced from public/app-logo.png' -ForegroundColor Green