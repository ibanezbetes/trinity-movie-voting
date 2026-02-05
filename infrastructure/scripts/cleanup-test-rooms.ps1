# Script para limpiar salas de prueba en DynamoDB
# Elimina todas las salas, votos y matches de desarrollo

Write-Host "🧹 Trinity - Limpieza de Salas de Prueba" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$REGION = "eu-west-1"
$ROOMS_TABLE = "trinity-rooms"
$VOTES_TABLE = "trinity-votes"
$MATCHES_TABLE = "trinity-matches"

# Función para contar items en una tabla
function Get-TableItemCount {
    param($TableName)
    
    try {
        $result = aws dynamodb describe-table --table-name $TableName --region $REGION --query 'Table.ItemCount' --output text
        return [int]$result
    } catch {
        return 0
    }
}

# Función para eliminar todos los items de una tabla
function Clear-DynamoDBTable {
    param(
        [string]$TableName,
        [string]$PartitionKey,
        [string]$SortKey = $null
    )
    
    Write-Host "📋 Limpiando tabla: $TableName" -ForegroundColor Yellow
    
    # Escanear todos los items (solo las claves, no todo el contenido)
    $scanCommand = "aws dynamodb scan --table-name $TableName --region $REGION --projection-expression ""$PartitionKey"
    if ($SortKey) {
        $scanCommand += ",$SortKey"
    }
    $scanCommand += """"
    
    try {
        $scanResult = Invoke-Expression $scanCommand | ConvertFrom-Json
    } catch {
        Write-Host "   ⚠️  Error escaneando tabla: $_" -ForegroundColor Red
        return 0
    }
    
    $items = $scanResult.Items
    $deletedCount = 0
    
    if ($items.Count -eq 0) {
        Write-Host "   ℹ️  Tabla vacía, nada que eliminar" -ForegroundColor Gray
        return 0
    }
    
    Write-Host "   Encontrados $($items.Count) items para eliminar..." -ForegroundColor Gray
    
    foreach ($item in $items) {
        try {
            # Construir la clave para eliminar
            $key = @{
                $PartitionKey = $item.$PartitionKey
            }
            
            if ($SortKey) {
                $key[$SortKey] = $item.$SortKey
            }
            
            $keyJson = $key | ConvertTo-Json -Compress
            
            # Eliminar el item
            aws dynamodb delete-item `
                --table-name $TableName `
                --key $keyJson `
                --region $REGION `
                --output json | Out-Null
            
            $deletedCount++
            
            if ($deletedCount % 10 -eq 0) {
                Write-Host "   Eliminados $deletedCount items..." -ForegroundColor DarkGray
            }
        } catch {
            Write-Host "   ⚠️  Error eliminando item: $_" -ForegroundColor Red
        }
    }
    
    Write-Host "   ✅ Eliminados $deletedCount items de $TableName" -ForegroundColor Green
    return $deletedCount
}

# Mostrar estado inicial
Write-Host "📊 Estado inicial de las tablas:" -ForegroundColor Cyan
$roomsCount = Get-TableItemCount $ROOMS_TABLE
$votesCount = Get-TableItemCount $VOTES_TABLE
$matchesCount = Get-TableItemCount $MATCHES_TABLE

Write-Host "   Salas: $roomsCount" -ForegroundColor White
Write-Host "   Votos: $votesCount" -ForegroundColor White
Write-Host "   Matches: $matchesCount" -ForegroundColor White
Write-Host ""

# Confirmar antes de eliminar
Write-Host "⚠️  ADVERTENCIA: Esta acción eliminará TODAS las salas, votos y matches." -ForegroundColor Red
Write-Host "   Esto incluye:" -ForegroundColor Yellow
Write-Host "   - $roomsCount salas" -ForegroundColor Yellow
Write-Host "   - $votesCount votos" -ForegroundColor Yellow
Write-Host "   - $matchesCount matches" -ForegroundColor Yellow
Write-Host ""

$confirmation = Read-Host "¿Estás seguro de que quieres continuar? (escribe 'SI' para confirmar)"

if ($confirmation -ne "SI") {
    Write-Host "`n❌ Operación cancelada" -ForegroundColor Red
    exit 0
}

Write-Host ""
Write-Host "🚀 Iniciando limpieza..." -ForegroundColor Cyan
Write-Host ""

# Limpiar tablas en orden
$totalDeleted = 0

# 1. Limpiar matches primero (no tienen dependencias)
$deleted = Clear-DynamoDBTable -TableName $MATCHES_TABLE -PartitionKey "roomId" -SortKey "movieId"
$totalDeleted += $deleted
Write-Host ""

# 2. Limpiar votos
$deleted = Clear-DynamoDBTable -TableName $VOTES_TABLE -PartitionKey "roomId" -SortKey "userMovieId"
$totalDeleted += $deleted
Write-Host ""

# 3. Limpiar salas
$deleted = Clear-DynamoDBTable -TableName $ROOMS_TABLE -PartitionKey "id"
$totalDeleted += $deleted
Write-Host ""

# Mostrar estado final
Write-Host "📊 Estado final de las tablas:" -ForegroundColor Cyan
Start-Sleep -Seconds 2  # Esperar a que DynamoDB actualice los contadores

$roomsCountFinal = Get-TableItemCount $ROOMS_TABLE
$votesCountFinal = Get-TableItemCount $VOTES_TABLE
$matchesCountFinal = Get-TableItemCount $MATCHES_TABLE

Write-Host "   Salas: $roomsCountFinal" -ForegroundColor White
Write-Host "   Votos: $votesCountFinal" -ForegroundColor White
Write-Host "   Matches: $matchesCountFinal" -ForegroundColor White
Write-Host ""

Write-Host "✅ Limpieza completada!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Resumen:" -ForegroundColor Cyan
Write-Host "   Total de items eliminados: $totalDeleted" -ForegroundColor White
Write-Host "   Salas eliminadas: $($roomsCount - $roomsCountFinal)" -ForegroundColor White
Write-Host "   Votos eliminados: $($votesCount - $votesCountFinal)" -ForegroundColor White
Write-Host "   Matches eliminados: $($matchesCount - $matchesCountFinal)" -ForegroundColor White
Write-Host ""
Write-Host "🎉 Las tablas están ahora limpias y listas para producción!" -ForegroundColor Green
Write-Host ""
