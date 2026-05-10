param(
    [string]$PiHost = "raspberrypi.local",
    [string]$PiUser = "pi",
    [string]$RemoteDir = "~/v2h-local-test",
    [string]$V2HIp = "",
    [switch]$RunStatusCheck,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$archiveName = "v2h-local-test.tgz"
$archivePath = Join-Path $projectRoot $archiveName
$remoteTarget = "${PiUser}@${PiHost}"
$remoteArchive = "/tmp/$archiveName"

$requiredCommands = @("tar", "scp", "ssh")
foreach ($command in $requiredCommands) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $command"
    }
}

$includePaths = @(
    "package.json",
    "package-lock.json",
    "index.js",
    "cli.js",
    "v2h-db.json",
    "lib",
    "test/field/raspi-status-check.sh",
    "test/field/raspi-discharge-test.sh",
    "test/field/raspi-charge-test.sh"
)

Push-Location $projectRoot
try {
    if (Test-Path $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }

    Write-Host "Creating $archivePath"
    tar -czf $archiveName @includePaths

    Write-Host "Copying archive to ${remoteTarget}:$remoteArchive"
    scp $archiveName "${remoteTarget}:$remoteArchive"

    $remoteCommands = @(
        "set -e",
        "rm -rf $RemoteDir",
        "mkdir -p $RemoteDir",
        "tar -xzf $remoteArchive -C $RemoteDir",
        "cd $RemoteDir"
    )

    if (-not $SkipNpmInstall) {
        $remoteCommands += "npm install"
    }

    if ($RunStatusCheck) {
        if ([string]::IsNullOrWhiteSpace($V2HIp)) {
            throw "-RunStatusCheck requires -V2HIp."
        }
        $remoteCommands += "bash test/field/raspi-status-check.sh --ip '$V2HIp'"
    } else {
        $remoteCommands += "echo 'Deployed to $RemoteDir'"
        $remoteCommands += "echo 'Run: cd $RemoteDir && bash test/field/raspi-status-check.sh --ip V2H_IP_ADDRESS'"
    }

    $remoteScript = $remoteCommands -join " && "
    Write-Host "Preparing files on $remoteTarget"
    ssh $remoteTarget $remoteScript
} finally {
    Pop-Location
}
