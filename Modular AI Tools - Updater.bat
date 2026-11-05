@echo off
setlocal
title Modular AI Tools - Updater
cd /d "%~dp0"
set "MAT_SELF=%~f0"
set "MAT_ARGS=%*"
where powershell >nul 2>nul
if errorlevel 1 (
    echo PowerShell was not found. It is included in Windows 7 SP1 and newer.
    pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create(((Get-Content -LiteralPath $env:MAT_SELF -Raw -Encoding UTF8).Split([string[]]('#!PS'+'!#'),2,[StringSplitOptions]::None)[1])))"
exit /b %errorlevel%
#!PS!#
# ===== Modular AI Tools - Updater =====
# Self-adapting: reads the HTML pages (and the scripts they load) to decide which files are needed.
$ErrorActionPreference = 'Stop'
$MODE   = 'update'          # install | update
$Repo   = 'shirosaki33/Modular-AI-Tools'
$ZipUrl = "https://github.com/$Repo/archive/HEAD.zip"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Self = $env:MAT_SELF
if (-not $Self) { $Self = (Join-Path (Get-Location).Path 'x.bat') }
$Here = Split-Path -Parent $Self
$ArgText = [string]$env:MAT_ARGS
$AutoYes = ($ArgText -match '(?i)(^|\s)/y(\s|$)')
$AutoAll = ($ArgText -match '(?i)(^|\s)/all(\s|$)')
$DirArg  = $null
if ($ArgText -match '(?i)/dir:"([^"]+)"') { $DirArg = $Matches[1] } elseif ($ArgText -match '(?i)/dir:(\S+)') { $DirArg = $Matches[1] }

function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }
function Ask($q, $d = '') { $a = Read-Host $q; if ([string]::IsNullOrWhiteSpace($a)) { return $d }; return $a.Trim() }
function YesNo($q, $defYes = $true) {
    if ($AutoYes) { return $true }
    $s = if ($defYes) { '[Y/n]' } else { '[y/N]' }
    $a = (Read-Host "$q $s").Trim().ToLower()
    if (-not $a) { return $defYes }
    return ($a -eq 'y' -or $a -eq 'yes')
}
function Fmt-Size($b) { if ($b -ge 1MB) { return ('{0:N1} MB' -f ($b / 1MB)) } elseif ($b -ge 1KB) { return ('{0:N0} KB' -f ($b / 1KB)) } else { return "$b B" } }

# ---------- download + index of the repository ----------
function Get-RepoZip {
    if ($env:MAT_ZIP) { return $env:MAT_ZIP }
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('modular-ai-tools-' + [guid]::NewGuid().ToString('N') + '.zip')
    Say "Downloading the latest version from GitHub ($Repo)..." 'Cyan'
    try {
        $wc = New-Object Net.WebClient
        $wc.Headers.Add('User-Agent', 'ModularAITools-Setup')
        $wc.DownloadFile($ZipUrl, $tmp)
    } catch {
        try { Invoke-WebRequest -UseBasicParsing -Uri $ZipUrl -OutFile $tmp -Headers @{ 'User-Agent' = 'ModularAITools-Setup' } }
        catch { throw "Could not download the repository ($($_.Exception.Message)). Check your internet connection." }
    }
    return $tmp
}

$ZipPath = Get-RepoZip
$Zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
$Files = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::OrdinalIgnoreCase)
$ByName = @{}
$prefix = $null
foreach ($e in $Zip.Entries) {
    if ($e.FullName.EndsWith('/')) { continue }
    if ($null -eq $prefix) { $prefix = $e.FullName.Substring(0, $e.FullName.IndexOf('/') + 1) }
    $p = $e.FullName.Substring($prefix.Length)
    if (-not $p) { continue }
    $Files[$p] = @{ Path = $p; Entry = $e }
    $n = ($p.Split('/')[-1]).ToLower()
    if (-not $ByName.ContainsKey($n)) { $ByName[$n] = New-Object System.Collections.Generic.List[string] }
    $ByName[$n].Add($p)
}
if ($Files.Count -eq 0) { throw 'The downloaded repository is empty.' }

# ---------- rules ----------
function Is-Excluded($p) {
    $l = $p.ToLower()
    if ($l.StartsWith('local/') -or $l.StartsWith('models/') -or $l.StartsWith('.git') -or $l.StartsWith('backup_')) { return $true }
    if ($l.EndsWith('.bak') -or $l.EndsWith('.zip') -or $l.EndsWith('.tmp')) { return $true }
    $n = $l.Split('/')[-1]
    if ($n -like '*installer*.bat' -or $n -like '*updater*.bat') { return $true }
    return $false
}
function Is-Html($p) { $l = $p.ToLower(); return ($l.EndsWith('.html') -or $l.EndsWith('.htm')) }
function Is-Root($p) { return (-not $p.Contains('/')) }
$ScanExt = '.html', '.htm', '.js', '.mjs', '.css', '.py', '.bat', '.cmd'
$TextExt = '.html', '.htm', '.js', '.mjs', '.css', '.py', '.bat', '.cmd', '.txt', '.md', '.svg', '.xml', '.yml', '.yaml'
function Ext-Of($p) { return [IO.Path]::GetExtension($p).ToLower() }

$ToolPages = @($Files.Keys | Where-Object { (Is-Root $_) -and (Is-Html $_) -and ($_.ToLower() -ne 'index.html') } | Sort-Object)

# ---------- dependency discovery ----------
$L1 = [Text.Encoding]::GetEncoding(28591)
function Read-Bytes($entry) {
    $ms = New-Object IO.MemoryStream
    $st = $entry.Open(); try { $st.CopyTo($ms) } finally { $st.Dispose() }
    return ,$ms.ToArray()
}
function Read-Text($entry) {
    $sr = New-Object IO.StreamReader($entry.Open(), [Text.Encoding]::UTF8)
    try { return $sr.ReadToEnd() } finally { $sr.Dispose() }
}
function Norm-Path($s) {
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($seg in ($s -replace '\\', '/').Split('/')) {
        if ($seg -eq '' -or $seg -eq '.') { continue }
        if ($seg -eq '..') { if ($parts.Count) { $parts.RemoveAt($parts.Count - 1) }; continue }
        $parts.Add($seg)
    }
    return ($parts -join '/')
}
function Resolve-Ref($dir, $cand) {
    $c = ($cand -replace '\\', '/').Trim()
    if (-not $c -or $c.Contains('://') -or $c.StartsWith('//')) { return $null }
    if ($c.StartsWith('/')) { $c = $c.TrimStart('/') ; $try = @($c) }
    else { $try = @(); if ($dir) { $try += (Norm-Path ($dir + '/' + $c)) }; $try += (Norm-Path $c) }
    foreach ($t in $try) { if ($t -and $Files.ContainsKey($t)) { return $Files[$t].Path } }
    if (-not $c.Contains('/')) {   # a bare file name: accept it only if it is unique in the repository
        $n = $c.ToLower()
        if ($ByName.ContainsKey($n) -and $ByName[$n].Count -eq 1) { return $ByName[$n][0] }
    }
    return $null
}
$RefCache = @{}
$PathRx = New-Object Text.RegularExpressions.Regex('[A-Za-z0-9_\-./\\ ]{2,160}?\.(?:js|mjs|css|py|bat|cmd|json|txt|wasm|onnx|png|jpe?g|gif|svg|ico|woff2?|ttf|html?)\b', 'IgnoreCase')
$PyRx = New-Object Text.RegularExpressions.Regex('(?m)^[ \t]*(?:from|import)[ \t]+([A-Za-z_][A-Za-z0-9_]*)')
# Comments often mention other files ("see gallery_core.js") without loading them, so they are removed before searching for references.
function Strip-Comments($text, $ext) {
    if ($ext -eq '.html' -or $ext -eq '.htm') { $text = [regex]::Replace($text, '(?s)<!--.*?-->', ' ') }
    if ($ext -eq '.py') {
        $text = [regex]::Replace($text, '(?s)""".*?"""', ' ')
        $text = [regex]::Replace($text, "(?s)'''.*?'''", ' ')
        $text = [regex]::Replace($text, '(?m)^[ \t]*#.*$', ' ')
    } elseif ($ext -eq '.bat' -or $ext -eq '.cmd') {
        $text = [regex]::Replace($text, '(?mi)^[ \t]*(rem\b|::).*$', ' ')
    } else {
        $text = [regex]::Replace($text, '(?s)/\*.*?\*/', ' ')
        $text = [regex]::Replace($text, '(?m)(?<=^|\s)//.*$', ' ')
    }
    return $text
}
function Get-Refs($path) {
    if ($RefCache.ContainsKey($path)) { return $RefCache[$path] }
    $out = New-Object System.Collections.Generic.List[string]
    $ext = Ext-Of $path
    $entry = $Files[$path].Entry
    if (($ScanExt -contains $ext) -and $entry.Length -lt 3MB) {
        $text = Strip-Comments (Read-Text $entry) $ext
        $dir = ''
        if ($path.Contains('/')) { $dir = $path.Substring(0, $path.LastIndexOf('/')) }
        foreach ($m in $PathRx.Matches($text)) {
            $words = $m.Value.Trim().Split(' ')
            for ($i = 0; $i -lt $words.Count; $i++) {   # "see tools/a.js" -> try "see tools/a.js", then "tools/a.js"
                $cand = ($words[$i..($words.Count - 1)] -join ' ')
                $r = Resolve-Ref $dir $cand
                if ($r) { if (-not $out.Contains($r)) { $out.Add($r) }; break }
            }
        }
        if ($ext -eq '.py') {
            foreach ($m in $PyRx.Matches($text)) {
                $r = Resolve-Ref '' ($m.Groups[1].Value + '.py')
                if ($r -and -not $out.Contains($r)) { $out.Add($r) }
            }
        }
    }
    $RefCache[$path] = $out
    return $out
}
# Everything a set of starting files needs (scripts, parsers, python modules...). Links to OTHER pages (.html) and user data
# (local/, models/) are not dependencies, so they are never followed.
function Get-Closure($roots) {
    $set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $q = New-Object System.Collections.Generic.Queue[string]
    foreach ($r in $roots) { if ($Files.ContainsKey($r) -and $set.Add($Files[$r].Path)) { $q.Enqueue($Files[$r].Path) } }
    while ($q.Count) {
        $p = $q.Dequeue()
        foreach ($d in (Get-Refs $p)) {
            if ((Is-Excluded $d) -or (Is-Html $d)) { continue }
            if ($set.Add($d)) { $q.Enqueue($d) }
        }
    }
    return ,$set   # the comma keeps it a HashSet (otherwise PowerShell unrolls it into an array)
}
function Size-Of($set) { $t = 0; foreach ($p in $set) { $t += $Files[$p].Entry.Length }; return $t }

# Base = what every install needs: the launcher .bat files, server_max.py, index.html, README/LICENSE (all root files that are not a tool page).
$BaseRoots = @($Files.Keys | Where-Object { (Is-Root $_) -and -not (Is-Excluded $_) -and ((-not (Is-Html $_)) -or $_.ToLower() -eq 'index.html') })

# ---------- apply ----------
$DirSep = [string][IO.Path]::DirectorySeparatorChar
function Local-Path($dest, $p) { return (Join-Path $dest $p.Replace('/', $DirSep)) }
function Norm-Hash([byte[]]$b, [bool]$text) {
    if ($text) { $b = $L1.GetBytes($L1.GetString($b).Replace("`r`n", "`n")) }
    $h = [Security.Cryptography.SHA256]::Create()
    return [BitConverter]::ToString($h.ComputeHash($b))
}
function Get-Plan($set, $dest) {
    $plan = @()
    foreach ($p in ($set | Sort-Object)) {
        $lp = Local-Path $dest $p
        $isText = ($TextExt -contains (Ext-Of $p))
        $remote = Read-Bytes $Files[$p].Entry
        $status = 'new'
        if (Test-Path -LiteralPath $lp -PathType Leaf) {
            $local = [IO.File]::ReadAllBytes($lp)
            if ((Norm-Hash $local $isText) -eq (Norm-Hash $remote $isText)) { $status = 'same' } else { $status = 'changed' }
        }
        $plan += [pscustomobject]@{ Path = $p; Local = $lp; Status = $status; Bytes = $remote; Text = $isText }
    }
    return $plan
}
function Apply-Plan($plan, $dest) {
    $stamp = (Get-Date).ToString('yyyyMMdd_HHmmss')
    $bakRoot = Join-Path (Join-Path $dest ("backup_" + $MODE)) $stamp
    $nNew = 0; $nUpd = 0; $fail = @(); $backedUp = 0
    foreach ($it in $plan) {
        if ($it.Status -eq 'same') { continue }
        try {
            $dir = Split-Path -Parent $it.Local
            if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            if ($it.Status -eq 'changed') {
                $bp = Join-Path $bakRoot $it.Path.Replace('/', $DirSep)
                $bd = Split-Path -Parent $bp
                if (-not (Test-Path -LiteralPath $bd)) { New-Item -ItemType Directory -Path $bd -Force | Out-Null }
                Copy-Item -LiteralPath $it.Local -Destination $bp -Force
                $backedUp++
            }
            $bytes = $it.Bytes
            $e = Ext-Of $it.Path
            if ($e -eq '.bat' -or $e -eq '.cmd') {   # cmd needs Windows line endings
                $s = $L1.GetString($bytes)
                $s = [regex]::Replace($s, "(?<!`r)`n", "`r`n")
                $bytes = $L1.GetBytes($s)
            }
            [IO.File]::WriteAllBytes($it.Local, $bytes)
            if ($it.Status -eq 'new') { $nNew++ } else { $nUpd++ }
        } catch { $fail += ("{0}: {1}" -f $it.Path, $_.Exception.Message) }
    }
    return [pscustomobject]@{ New = $nNew; Updated = $nUpd; Failed = $fail; Backup = $(if ($backedUp) { $bakRoot } else { $null }) }
}
function Show-Result($r) {
    Say ''
    Say ("Done: {0} new file(s), {1} updated file(s)." -f $r.New, $r.Updated) 'Green'
    if ($r.Backup) { Say "Previous versions of the replaced files were saved in: $($r.Backup)" 'DarkGray' }
    if ($r.Failed.Count) { Say 'These files could not be written (close the app and try again):' 'Yellow'; $r.Failed | ForEach-Object { Say "  $_" 'Yellow' } }
}
function Parse-Choice($text, $max) {
    $sel = New-Object System.Collections.Generic.List[int]
    if ($text -match '^(?i)\s*a(ll)?\s*$') { 1..$max | ForEach-Object { $sel.Add($_) }; return $sel }
    foreach ($tok in ($text -split '[,\s]+')) {
        if (-not $tok) { continue }
        if ($tok -match '^(\d+)-(\d+)$') { for ($i = [int]$Matches[1]; $i -le [int]$Matches[2]; $i++) { if ($i -ge 1 -and $i -le $max -and -not $sel.Contains($i)) { $sel.Add($i) } } }
        elseif ($tok -match '^\d+$') { $i = [int]$tok; if ($i -ge 1 -and $i -le $max -and -not $sel.Contains($i)) { $sel.Add($i) } }
    }
    return $sel
}
function Show-Tools($pages, $baseSet, $label) {
    $i = 1
    foreach ($t in $pages) {
        $cl = Get-Closure @($t)
        $extra = @($cl | Where-Object { -not $baseSet.Contains($_) -and $_ -ne $t })
        Say ("  [{0}] {1}  (+{2} files, {3})" -f $i, ([IO.Path]::GetFileNameWithoutExtension($t)), $extra.Count, (Fmt-Size (Size-Of $extra))) 'White'
        $i++
    }
}

try {
    Say ''
    Say '==============================================' 'Cyan'
    Say ('  Modular AI Tools - ' + $(if ($MODE -eq 'install') { 'Installer' } else { 'Updater' })) 'Cyan'
    Say "  Source: https://github.com/$Repo" 'DarkGray'
    Say '==============================================' 'Cyan'
    Say ("Repository downloaded: {0} files, {1} tool pages." -f $Files.Count, $ToolPages.Count) 'DarkGray'
    $BaseSet = Get-Closure $BaseRoots

    if ($MODE -eq 'install') {
        # ===================== INSTALLER =====================
        $Dest = $Here
        if ($DirArg) { $Dest = $DirArg }
        elseif (-not $AutoYes) {
            Say ''
            $a = Ask "Install folder (Enter = $Here)" $Here
            $Dest = $a.Trim('"')
        }
        if (-not (Test-Path -LiteralPath $Dest)) { New-Item -ItemType Directory -Path $Dest -Force | Out-Null }
        $Dest = (Resolve-Path -LiteralPath $Dest).Path
        Say "Installing into: $Dest" 'White'

        $everything = $AutoAll
        $set = $null
        if (-not $AutoAll) {
            Say ''
            Say 'What do you want to install?' 'Yellow'
            Say '  [1] Everything (all tools)'
            Say '  [2] Let me choose the tools'
            $m = Ask 'Choice' '1'
            $everything = ($m -ne '2')
        }
        if ($everything) {
            $set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
            foreach ($p in $Files.Keys) { if (-not (Is-Excluded $p)) { [void]$set.Add($Files[$p].Path) } }
        } else {
            Say ''
            Say 'Tools (the files each one needs are found automatically):' 'Yellow'
            Show-Tools $ToolPages $BaseSet
            Say ''
            $c = Ask 'Type the numbers separated by commas (example: 1,3 or 2-4), or A for all' 'A'
            $sel = @(Parse-Choice $c $ToolPages.Count)
            if ($sel.Count -eq 0) { Say 'Nothing selected.' 'Yellow'; throw 'cancelled' }
            $roots = @($BaseRoots) + @($sel | ForEach-Object { $ToolPages[$_ - 1] })
            $set = Get-Closure $roots
            Say ("Selected: " + (($sel | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($ToolPages[$_ - 1]) }) -join ', ')) 'DarkGray'
        }

        # starter tag caches (user data): offered once, never overwritten
        $caches = @($Files.Keys | Where-Object { $_.ToLower().StartsWith('local/') -and $_.ToLower().EndsWith('.json') })
        $newCaches = @($caches | Where-Object { -not (Test-Path -LiteralPath (Local-Path $Dest $_)) })
        if ($newCaches.Count -gt 0) {
            $cs = 0; foreach ($p in $newCaches) { $cs += $Files[$p].Entry.Length }
            Say ''
            if (YesNo ("Include the starter Danbooru / e621 tag cache (" + (Fmt-Size $cs) + ")? Existing cache files are never overwritten.") $true) {
                foreach ($p in $newCaches) { [void]$set.Add($Files[$p].Path) }
            }
        }

        $plan = Get-Plan $set $Dest
        $new = @($plan | Where-Object { $_.Status -eq 'new' }); $chg = @($plan | Where-Object { $_.Status -eq 'changed' }); $same = @($plan | Where-Object { $_.Status -eq 'same' })
        $tot = 0; foreach ($it in ($new + $chg)) { $tot += $it.Bytes.Length }
        Say ''
        Say ("Ready: {0} file(s) to download ({1}), {2} already up to date." -f ($new.Count + $chg.Count), (Fmt-Size $tot), $same.Count) 'White'
        if ($chg.Count) { Say ("{0} existing file(s) differ from GitHub and will be replaced (a copy is kept in backup_install\...)." -f $chg.Count) 'Yellow' }
        if (($new.Count + $chg.Count) -eq 0) { Say 'Everything is already installed and up to date.' 'Green' }
        elseif (YesNo 'Continue?' $true) {
            $r = Apply-Plan $plan $Dest
            Show-Result $r
            $py = (Get-Command python -ErrorAction SilentlyContinue); if (-not $py) { $py = (Get-Command py -ErrorAction SilentlyContinue) }
            if (-not $py) { Say 'Python was not found. Install it from https://www.python.org (check "Add to PATH") to use localhost mode.' 'Yellow' }
            $launcher = Join-Path $Dest 'Modular AI Tools localhost.bat'
            if ((Test-Path -LiteralPath $launcher) -and $py -and -not $AutoYes) {
                if (YesNo 'Start the app now (localhost)?' $true) { Start-Process -FilePath $launcher -WorkingDirectory $Dest }
            }
        } else { Say 'Cancelled.' 'Yellow' }
    }
    else {
        # ===================== UPDATER =====================
        $Dest = $Here
        $installed = @($ToolPages | Where-Object { Test-Path -LiteralPath (Local-Path $Dest $_) -PathType Leaf })
        if ($installed.Count -eq 0) {
            Say ''
            Say 'No known tool page (.html) was found in this folder.' 'Yellow'
            Say 'Put this updater in the same folder as the HTML files, or use the Installer.' 'Yellow'
            throw 'cancelled'
        }
        Say ("Installed tools found here: " + (($installed | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_) }) -join ', ')) 'White'

        $roots = New-Object System.Collections.Generic.List[string]
        foreach ($t in $installed) { $roots.Add($t) }
        foreach ($b in $BaseRoots) { if (Test-Path -LiteralPath (Local-Path $Dest $b) -PathType Leaf) { $roots.Add($b) } }
        $set = Get-Closure $roots

        # tools that exist on GitHub but not here
        $missing = @($ToolPages | Where-Object { $installed -notcontains $_ })
        if ($missing.Count -gt 0 -and -not $AutoYes) {
            Say ''
            Say 'New tools available on GitHub (not installed here):' 'Yellow'
            Show-Tools $missing $BaseSet
            $c = Ask 'Type the numbers to install them too (Enter = skip)' ''
            if ($c) {
                $sel = @(Parse-Choice $c $missing.Count)
                foreach ($i in $sel) { foreach ($f in (Get-Closure @($missing[$i - 1]))) { [void]$set.Add($f) } }
            }
        } elseif ($missing.Count -gt 0 -and $AutoAll) {
            foreach ($t in $missing) { foreach ($f in (Get-Closure @($t))) { [void]$set.Add($f) } }
        }

        $plan = Get-Plan $set $Dest
        $new = @($plan | Where-Object { $_.Status -eq 'new' }); $chg = @($plan | Where-Object { $_.Status -eq 'changed' }); $same = @($plan | Where-Object { $_.Status -eq 'same' })
        Say ''
        if ($chg.Count) { Say ("Updated on GitHub ({0}):" -f $chg.Count) 'Yellow'; $chg | ForEach-Object { Say ("  ~ " + $_.Path) 'White' } }
        if ($new.Count) { Say ("New files ({0}):" -f $new.Count) 'Yellow'; $new | ForEach-Object { Say ("  + " + $_.Path) 'White' } }
        Say ("{0} file(s) already up to date." -f $same.Count) 'DarkGray'
        if (($new.Count + $chg.Count) -eq 0) { Say 'Everything is up to date.' 'Green' }
        else {
            Say ''
            Say 'Your data (local\, models\) is never touched. Replaced files are copied to backup_update\ first.' 'DarkGray'
            Say 'Note: files you edited yourself will be replaced by the GitHub version (see the backup).' 'DarkGray'
            if (YesNo 'Update now?' $true) { $r = Apply-Plan $plan $Dest; Show-Result $r } else { Say 'Cancelled.' 'Yellow' }
        }
    }
}
catch {
    if ($_.Exception.Message -ne 'cancelled') { Say ''; Say ('ERROR: ' + $_.Exception.Message) 'Red' }
}
finally {
    try { $Zip.Dispose() } catch {}
    if (-not $env:MAT_ZIP -and $ZipPath -and (Test-Path -LiteralPath $ZipPath)) { Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue }
}
if (-not $AutoYes) { Say ''; [void](Read-Host 'Press Enter to close') }
