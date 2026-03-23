<#
.SYNOPSIS
Create or reuse a SharePoint Embedded container type and attach billing using Add-SPOContainerTypeBilling.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$TenantAdminUrl,

    [Parameter(Mandatory = $true)]
    [string]$ContainerTypeName,

    [Parameter(Mandatory = $true)]
    [Guid]$OwningAppId,

    [Parameter(Mandatory = $true)]
    [Guid]$AzureSubscriptionId,

    [Parameter(Mandatory = $true)]
    [string]$ResourceGroup,

    [Parameter(Mandatory = $true)]
    [string]$Region
)

$ErrorActionPreference = "Stop"

# Load SPO module
Import-Module Microsoft.Online.SharePoint.PowerShell -Force

# Verify required cmdlets
$requiredCmdlets = @(
    "Connect-SPOService",
    "Disconnect-SPOService",
    "Get-SPOContainerType",
    "New-SPOContainerType",
    "Add-SPOContainerTypeBilling"
)

foreach ($cmd in $requiredCmdlets) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Required cmdlet '$cmd' not found. Ensure the SPO module is loaded and supports SharePoint Embedded billing."
    }
}

try {
    Write-Host "SPO PowerShell loaded." -ForegroundColor Green
    Write-Host "Connecting to: $TenantAdminUrl" -ForegroundColor DarkGray

    Connect-SPOService -Url $TenantAdminUrl
    Write-Host "Connected." -ForegroundColor Green

    # Find existing container type for this owning app
    Write-Host ""
    Write-Host "Resolving container type..." -ForegroundColor Yellow

    $containerType = $null
    $allTypes = Get-SPOContainerType

    foreach ($ct in $allTypes) {
        if ($ct.OwningApplicationId -eq $OwningAppId) {
            $containerType = $ct
            break
        }
    }

    # Create if missing
    if ($null -eq $containerType) {
        Write-Host "No container type found; creating '$ContainerTypeName'..." -ForegroundColor Yellow

        $containerType = New-SPOContainerType `
            -ContainerTypeName $ContainerTypeName `
            -OwningApplicationId $OwningAppId

        Write-Host "Container type created." -ForegroundColor Green
    }
    else {
        Write-Host "Existing container type found." -ForegroundColor Green
    }

    Write-Host ("ContainerTypeId: {0}" -f $containerType.ContainerTypeId) -ForegroundColor Cyan
    Write-Host ("Name:           {0}" -f $containerType.ContainerTypeName) -ForegroundColor Cyan

    # Determine whether billing is missing
    $azureSubIdValue = ""
    if ($null -ne $containerType.AzureSubscriptionId) {
        $azureSubIdValue = [string]$containerType.AzureSubscriptionId
    }

    $billingMissing = [string]::IsNullOrWhiteSpace($azureSubIdValue) -or
                      ($azureSubIdValue -eq "00000000-0000-0000-0000-000000000000")

    # Attach billing if missing
    if ($billingMissing) {
        Write-Host ""
        Write-Host "Attaching billing..." -ForegroundColor Yellow
        Write-Host ("Subscription:  {0}" -f $AzureSubscriptionId) -ForegroundColor DarkGray
        Write-Host ("ResourceGroup: {0}" -f $ResourceGroup) -ForegroundColor DarkGray
        Write-Host ("Region:        {0}" -f $Region) -ForegroundColor DarkGray

        Add-SPOContainerTypeBilling `
            -ContainerTypeId $containerType.ContainerTypeId `
            -AzureSubscriptionId $AzureSubscriptionId `
            -ResourceGroup $ResourceGroup `
            -Region $Region

        Write-Host "Billing attached." -ForegroundColor Green
    }
    else {
        Write-Host ""
        Write-Host "Billing already present; skipping attach." -ForegroundColor Yellow
    }

    # Verify final state
    Write-Host ""
    Write-Host "Verifying..." -ForegroundColor Yellow

    $final = Get-SPOContainerType -ContainerTypeId $containerType.ContainerTypeId

    Write-Host ""
    Write-Host "COMPLETE" -ForegroundColor Green
    Write-Host "======================================"
    Write-Host ("ContainerTypeId:     {0}" -f $final.ContainerTypeId)
    Write-Host ("Name:                {0}" -f $final.ContainerTypeName)
    Write-Host ("OwningAppId:          {0}" -f $final.OwningApplicationId)
    Write-Host ("AzureSubscriptionId: {0}" -f $final.AzureSubscriptionId)
    Write-Host ("ResourceGroup:       {0}" -f $final.ResourceGroup)
    Write-Host ("Region:              {0}" -f $final.Region)

    # Return object for pipeline use
    [PSCustomObject]@{
        ContainerTypeId     = $final.ContainerTypeId
        ContainerTypeName   = $final.ContainerTypeName
        OwningApplicationId = $final.OwningApplicationId
        AzureSubscriptionId = $final.AzureSubscriptionId
        ResourceGroup       = $final.ResourceGroup
        Region              = $final.Region
        TenantAdminUrl      = $TenantAdminUrl
    }
}
finally {
    try { Disconnect-SPOService | Out-Null } catch { }
}