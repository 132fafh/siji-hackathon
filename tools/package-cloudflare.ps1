$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Join-Path $PSScriptRoot 'cloudflare-pages'
$destination = Join-Path $PSScriptRoot 'cloudflare-pages.zip'
$stream = [System.IO.File]::Open($destination, [System.IO.FileMode]::Create)
try {
  $archive = New-Object System.IO.Compression.ZipArchive -ArgumentList $stream, ([System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {
      $name = $_.FullName.Substring($root.Length).TrimStart('\').Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally {
    $archive.Dispose()
  }
} finally {
  $stream.Dispose()
}
Write-Output $destination
