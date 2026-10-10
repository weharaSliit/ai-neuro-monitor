# Opens the thesis in Word, rebuilds the table of contents / lists / page numbers, saves it and exports a PDF preview.
# Run after build_thesis.py:  powershell -File thesis/update_fields.ps1
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $dir 'Individual_Thesis_DRAFT.docx'
$pdf = Join-Path $dir 'preview.pdf'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($src)
  1..2 | ForEach-Object {
    $doc.Fields.Update() | Out-Null
    foreach ($t in $doc.TablesOfContents) { $t.Update() }
    foreach ($t in $doc.TablesOfFigures) { $t.Update() }
  }
  $doc.Repaginate()
  "pages: " + $doc.ComputeStatistics(2)
  "words: " + $doc.ComputeStatistics(0)
  $doc.ExportAsFixedFormat($pdf, 17)
  $doc.Save()
  $doc.Close(0)
} finally { $word.Quit() }
