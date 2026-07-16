"""Create the first administrator from a private container terminal."""

from __future__ import annotations

import getpass

from fastapi import HTTPException

from .auth import setup_admin, setup_required


def main() -> None:
    if not setup_required():
        raise SystemExit("İlk yönetici zaten oluşturulmuş; hiçbir değişiklik yapılmadı.")

    display_name = input("Yönetici adı: ").strip() or "Yönetici"
    pin = getpass.getpass("En az 6 karakterli erişim kodu: ")
    confirmation = getpass.getpass("Erişim kodunu tekrar girin: ")
    if pin != confirmation:
        raise SystemExit("Erişim kodları eşleşmedi; hiçbir değişiklik yapılmadı.")
    try:
        actor = setup_admin(display_name, pin)
    except HTTPException as exc:
        raise SystemExit(str(exc.detail)) from exc
    print(f"İlk yönetici güvenle oluşturuldu: {actor.name}")


if __name__ == "__main__":
    main()
