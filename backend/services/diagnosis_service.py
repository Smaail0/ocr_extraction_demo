import os
import re
from typing import List, Dict, Any
from dotenv import load_dotenv
from huggingface_hub import InferenceClient

load_dotenv(override=True)

client = InferenceClient(
    provider="novita",
    api_key=os.getenv("HF_API_TOKEN")
)

def strip_chain_of_thought(text: str) -> str:
    """
    Supprime tout bloc <think>...</think> du texte renvoyé par le modèle.
    """
    return re.sub(r"<think>.*?</think>\s*", "", text, flags=re.DOTALL)

def get_probable_diagnoses_deepseek(
    items: List[Dict[str, str]]
) -> Dict[str, Any]:
    """
    Étant donné une liste d'items de prescription (avec le champ 'produit'),
    cette fonction appelle deepseek-ai/DeepSeek-R1-0528 et renvoie :
      - 'diagnostiques' : jusqu'à deux diagnostics probables (en français)
      - 'medicament_hors_norme' : tout médicament détecté comme hors norme (ou None)
      - 'raw_response' : texte brut (sans <think>…</think>), en français
    """
    meds = [item.get("produit", "").strip() for item in items if item.get("produit")]
    if not meds:
        raise ValueError("`items` doit contenir au moins un nom de médicament dans 'produit'.")

    # Build the prompt
    prompt_lines = [
        "Vous êtes une assistante médicale IA. Je vais vous donner une liste de médicaments :",
        "- Ne montrez pas votre raisonnement interne ni votre réfléxion en chaîne.",
        "- Répondez uniquement en français, dans le format **exact** suivant :",
        "    Diagnostiques : <diagnostic1>, <diagnostic2>",
        "    Médicament hors norme : <nom du médicament> (ou “Aucun” si rien n'est hors norme)",
        "",
        "Médicaments :"
    ]
    for idx, med in enumerate(meds, start=1):
        prompt_lines.append(f"  {idx}. {med}")
    prompt_lines.append("")           # blank line
    prompt_lines.append("Réponse :")

    user_content = "\n".join(prompt_lines)

    # Call the model, passing parameters at top level
    completion = client.chat.completions.create(
        model="deepseek-ai/DeepSeek-R1-0528",
        messages=[
            {"role": "system", "content": "Vous êtes une assistante médicale IA."},
            {"role": "user",   "content": user_content}
        ],
        temperature=0.2,
        max_tokens=150
    )

    raw = completion.choices[0].message.content.strip()
    cleaned = strip_chain_of_thought(raw)

    # 4) Parser “Diagnostiques :” et “Médicament hors norme :” dans le texte nettoyé
    diagnostiques: List[str] = []
    medicament_hors_norme = None

    for line in cleaned.splitlines():
        lower = line.lower()
        if lower.startswith("diagnostiques"):
            # ex. "Diagnostiques : Hypertension, Diabète"
            if ":" in line:
                parts = line.split(":", 1)[1].strip()
                diagnostiques = [d.strip() for d in parts.split(",") if d.strip()]
        elif lower.startswith("médicament hors norme"):
            # ex. "Médicament hors norme : CALCIFAST 500MG B/30"
            if ":" in line:
                medicament_hors_norme = line.split(":", 1)[1].strip()
                if medicament_hors_norme.lower() in ("aucun", "none", ""):
                    medicament_hors_norme = None

    # 5) En cas de fallback s’il n’y a pas explicitement “Diagnostiques :”
    if not diagnostiques:
        first_line = cleaned.splitlines()[0]
        if "," in first_line:
            diagnostiques = [d.strip() for d in first_line.split(",")][:2]

    return {
        "diagnostiques": diagnostiques[:2],
        "medicament_hors_norme": medicament_hors_norme,
        "raw_response": cleaned
    }


if __name__ == "__main__":
    # Quick local test
    os.environ.setdefault("HF_API_TOKEN", "hf_your_actual_token_here")

    sample_items = [
        {"codePCT": "301050", "produit": "CALCIFAST 500MG B/30"},
        {"codePCT": "123456", "produit": "LISINOPRIL 10MG"},
        {"codePCT": "789012", "produit": "METFORMIN 500MG"}
    ]

    print(">>> Testing get_probable_diagnoses_deepseek …\n")
    try:
        result = get_probable_diagnoses_deepseek(sample_items)
        print("Top Diagnoses:", result["diagnoses"])
        print("Outlier Medication:", result["outlier_medication"])
        print("\nRaw HF Response:\n", result["raw_response"])
    except Exception as exc:
        print("Error:", exc)