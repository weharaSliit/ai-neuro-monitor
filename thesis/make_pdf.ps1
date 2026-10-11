# Exports thesis/preview.pdf from Individual_Thesis_DRAFT.docx using Word, on a temporary copy
# (the .docx is never modified). A watchdog stops only the Word instance started here if it stalls.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $dir 'Individual_Thesis_DRAFT.docx'
$out = Join-Path $dir 'preview.pdf'
$tmpDoc = Join-Path $env:TEMP 'thesis_pdf_copy.docx'
$tmpPdf = Join-Path $env:TEMP 'thesis_pdf_copy.pdf'
Remove-Item $tmpPdf -Force -ErrorAction SilentlyContinue
Copy-Item $src $tmpDoc -Force

$before = @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
Start-Sleep -Seconds 2
$mine = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
"my Word pid(s): $($mine -join ',')"

$watchdog = Start-Job -ArgumentList (,$mine) -ScriptBlock {
    param($ids)
    Start-Sleep -Seconds 100
    foreach ($i in $ids) { Stop-Process -Id $i -Force -ErrorAction SilentlyContinue }
}
try {
    $doc = $word.Documents.Open($tmpDoc, $false, $true)   # read-only copy
    1..2 | ForEach-Object {
        $doc.Fields.Update() | Out-Null
        foreach ($t in $doc.TablesOfContents) { $t.Update() }
        foreach ($t in $doc.TablesOfFigures) { $t.Update() }
    }
    $doc.Repaginate()
    "pages: " + $doc.ComputeStatistics(2)
    "words: " + $doc.ComputeStatistics(0)
    $doc.SaveAs2($tmpPdf, 17)   # wdFormatPDF
    $doc.Close(0)
    Copy-Item $tmpPdf $out -Force
    "exported: $out"
} catch {
    "FAILED: $($_.Exception.Message)"
} finally {
    Stop-Job $watchdog -ErrorAction SilentlyContinue
    Remove-Job $watchdog -Force -ErrorAction SilentlyContinue
    try { $word.Quit() } catch { }
    foreach ($i in $mine) { Stop-Process -Id $i -Force -ErrorAction SilentlyContinue }
}
