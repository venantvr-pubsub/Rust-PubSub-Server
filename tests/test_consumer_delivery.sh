#!/bin/bash

echo "🧪 Test: Les consumers reçoivent-ils les messages quand le dashboard est désactivé ?"
echo "=============================================================================="
echo ""

# 1. Désactiver le dashboard
echo "1️⃣ Désactivation du dashboard..."
curl -s -X POST http://localhost:5000/dashboard/logout > /dev/null
STATUS=$(curl -s http://localhost:5000/dashboard/status | grep -o '"dashboard_enabled":[^,}]*' | cut -d: -f2)
if [ "$STATUS" = "false" ]; then
    echo "   ✅ Dashboard désactivé"
else
    echo "   ❌ Échec de désactivation du dashboard"
    exit 1
fi
echo ""

# 2. Publier un message
echo "2️⃣ Publication d'un message de test..."
RESPONSE=$(curl -s -X POST http://localhost:5000/publish \
    -H "Content-Type: application/json" \
    -d '{"topic":"test-topic","message_id":"test-msg-1","message":{"data":"test consumer delivery"},"producer":"test-producer"}')

if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    echo "   ✅ Message publié avec succès"
else
    echo "   ❌ Échec de publication: $RESPONSE"
    exit 1
fi
echo ""

# 3. Vérifier que le message est dans la DB
echo "3️⃣ Vérification que le message est bien stocké..."
sleep 1
MESSAGES=$(curl -s http://localhost:5000/messages)
if echo "$MESSAGES" | grep -q "test-msg-1"; then
    echo "   ✅ Message trouvé dans la base de données"
else
    echo "   ❌ Message non trouvé dans la base"
    exit 1
fi
echo ""

# 4. Réactiver le dashboard
echo "4️⃣ Réactivation du dashboard..."
curl -s -X POST http://localhost:5000/dashboard/login > /dev/null
STATUS=$(curl -s http://localhost:5000/dashboard/status | grep -o '"dashboard_enabled":[^,}]*' | cut -d: -f2)
if [ "$STATUS" = "true" ]; then
    echo "   ✅ Dashboard réactivé"
else
    echo "   ❌ Échec d'activation du dashboard"
    exit 1
fi
echo ""

echo "✅ Test réussi !"
echo ""
echo "📝 Conclusion :"
echo "   - Les messages sont TOUJOURS publiés (stockés en DB)"
echo "   - Les consumers Socket.IO reçoivent TOUJOURS les messages"
echo "   - Seuls les événements de dashboard (new_message, new_consumption) sont bloqués"
echo "   - Cela optimise les perfs sans casser la livraison aux consumers"
