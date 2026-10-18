param(
    [string]$ApiBase = 'http://127.0.0.1:8000/api',
    [string]$ReportPath = (Join-Path $PSScriptRoot '..\reports\local-demo-verification.json')
)

$ErrorActionPreference = 'Stop'
$ApiBase = $ApiBase.TrimEnd('/')
$results = [System.Collections.Generic.List[object]]::new()
$runStarted = (Get-Date).ToUniversalTime().ToString('o')
$finalStatus = 'running'
$failure = $null

function Invoke-Api {
    param([string]$Path, [string]$Method = 'GET', $Body = $null)
    $request = @{ Uri = "$ApiBase$Path"; Method = $Method; TimeoutSec = 30 }
    if ($null -ne $Body) {
        $request.ContentType = 'application/json'
        $request.Body = $Body | ConvertTo-Json -Depth 20 -Compress
    }
    Invoke-RestMethod @request
}

function Reset-DemoData {
    $reset = Invoke-Api -Path '/simulator/reset' -Method POST -Body @{}
    if (-not $reset.reset) { throw 'Reset endpoint did not confirm reset.' }
}

function Get-CaseDetail {
    param([string]$CaseId)
    Invoke-Api -Path "/cases/$([uri]::EscapeDataString($CaseId))"
}

try {
    $health = Invoke-Api -Path '/health'
    if ($health.status -ne 'healthy') { throw "Backend health was '$($health.status)' instead of healthy." }
    if ($health.llm -ne 'deterministic fallback') { throw "No-key verification requires the deterministic fallback; current backend reports '$($health.llm)'. Clear optional model settings before startup." }
    $results.Add([pscustomobject]@{ name='backend health'; status='passed'; details=$health.status })

    # Stop the synthetic background feed so each fixture runs independently.
    $null = Invoke-Api -Path '/simulator/stop' -Method POST -Body @{}
    Reset-DemoData
    $ordinary = Invoke-Api -Path '/simulator/ordinary' -Method POST -Body @{}
    $ordinaryRecord = Invoke-Api -Path "/transactions/$([uri]::EscapeDataString($ordinary.id))"
    if ($ordinaryRecord.id -ne $ordinary.id) { throw 'Ordinary transaction was not available from persisted transaction storage.' }
    $results.Add([pscustomobject]@{ name='ordinary transaction'; status='passed'; transaction_id=$ordinary.id; persisted=$true })

    $fixtures = @(
        [pscustomobject]@{ id='RAPID_MULTI_HOP'; seed=731; expected='suspicious'; check='simulated hold' },
        [pscustomobject]@{ id='COLLECTION_ACCOUNT'; seed=732; expected='suspicious'; check='convergence case' },
        [pscustomobject]@{ id='CROSS_BANK_CHAIN'; seed=2042; expected='suspicious'; check='cross-bank graph' },
        [pscustomobject]@{ id='BENIGN_HIGH_ACTIVITY'; seed=733; expected='benign'; check='no case' },
        [pscustomobject]@{ id='LATE_DETECTION'; seed=734; expected='suspicious'; check='pending late response' }
    )
    $replayReference = $null
    foreach ($fixture in $fixtures) {
        Reset-DemoData
        $run = Invoke-Api -Path '/scenarios/run' -Method POST -Body @{ scenario=$fixture.id; seed=$fixture.seed }
        $caseIds = @($run.case_ids)
        if ($fixture.expected -eq 'suspicious' -and $caseIds.Count -eq 0) { throw "Expected a case for $($fixture.id), but none was returned." }
        if ($fixture.expected -eq 'benign' -and $caseIds.Count -ne 0) { throw "Benign fixture $($fixture.id) created $($caseIds.Count) case(s)." }
        $details = @()
        $graphEdgeCount = 0
        foreach ($caseId in $caseIds) {
            $detail = Get-CaseDetail -CaseId $caseId
            $details += $detail
            if (@($detail.report.timeline).Count -ne @($detail.transactions).Count) { throw "Report timeline does not match stored events for $caseId." }
            if (@($detail.report.supporting_transaction_ids).Count -eq 0) { throw "Case $caseId has no supporting transaction references." }
            $graph = Invoke-Api -Path "/graph?case_id=$([uri]::EscapeDataString($caseId))"
            if (@($graph.edges).Count -eq 0 -and @($detail.transactions).Count -gt 0) { throw "Fund trace for $caseId has no persisted transaction edges." }
            $graphEdgeCount += @($graph.edges).Count
        }
        if ($fixture.id -eq 'RAPID_MULTI_HOP') {
            $replayReference = @($run.transaction_ids)
            $interventions = Invoke-Api -Path '/interventions'
            if (-not ($interventions | Where-Object { $_.case_id -in $caseIds -and $_.status -eq 'SIMULATED_HOLD' })) { throw 'Rapid-flow scenario did not persist its simulated hold outcome.' }
        }
        if ($fixture.id -eq 'CROSS_BANK_CHAIN') {
            $banks = @($details | ForEach-Object { $_.transactions } | ForEach-Object { $_.source_bank; $_.dest_bank } | Sort-Object -Unique)
            if ($banks.Count -lt 3) { throw "Cross-bank trace includes only $($banks.Count) institution(s)." }
        }
        if ($fixture.id -eq 'LATE_DETECTION') {
            $interventions = Invoke-Api -Path '/interventions'
            if (-not ($interventions | Where-Object { $_.case_id -in $caseIds -and $_.status -eq 'PENDING' })) { throw 'Late-detection scenario did not retain a PENDING simulated response.' }
            if (-not ($details | Where-Object { $_.case.late -eq 1 })) { throw 'Late-detection case was not marked late.' }
        }
        if ($fixture.id -eq 'RAPID_MULTI_HOP' -and $health.llm -eq 'deterministic fallback') {
            if (-not $details[0].report.summary -or @($details[0].report.next_steps).Count -eq 0) { throw 'No-key investigation report is missing its summary or next steps.' }
        }
        $results.Add([pscustomobject]@{
            name=$fixture.id; status='passed'; seed=$fixture.seed; expected=$fixture.expected
            transaction_ids=@($run.transaction_ids); case_ids=$caseIds; case_count=$caseIds.Count
            graph_edges=$graphEdgeCount
            detection_mode=$run.detection_mode; late_detection=$run.late_detection
            intervention=$fixture.check
        })
        Write-Host "PASS $($fixture.id) seed=$($fixture.seed) events=$(@($run.transaction_ids).Count) cases=$($caseIds.Count)"
    }

    # Verify that reset clears cases and replay with the same seed reproduces event references.
    Reset-DemoData
    $remainingCases = Invoke-Api -Path '/cases'
    if ($null -ne $remainingCases -and @($remainingCases).Count -gt 0) { throw 'Reset left one or more cases behind.' }
    $replay = Invoke-Api -Path '/scenarios/run' -Method POST -Body @{ scenario='RAPID_MULTI_HOP'; seed=731 }
    if ((@($replay.transaction_ids) -join ',') -ne ($replayReference -join ',')) { throw 'Fixed-seed replay did not reproduce the same synthetic transaction IDs.' }
    $replayedCase = Get-CaseDetail -CaseId $replay.case_ids[0]
    if (-not $replayedCase.report.summary) { throw 'Replayed case did not return a persisted investigation report.' }
    $results.Add([pscustomobject]@{ name='reset and fixed-seed replay'; status='passed'; seed=731; transaction_ids=@($replay.transaction_ids); case_id=$replay.case_ids[0] })
    $finalStatus = 'passed'
} catch {
    $finalStatus = 'failed'
    $failure = $_.Exception.Message
    throw
} finally {
    $report = [pscustomobject]@{
        started_at_utc=$runStarted
        completed_at_utc=(Get-Date).ToUniversalTime().ToString('o')
        status=$finalStatus
        api_base=$ApiBase
        data_type='Synthetic only'
        results=@($results)
        failure=$failure
    }
    $resolvedReport = [System.IO.Path]::GetFullPath($ReportPath)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedReport) | Out-Null
    $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $resolvedReport -Encoding utf8
    Write-Host "Scenario verification report: $resolvedReport"
    Write-Host "Scenario verification status: $finalStatus"
}
