#!/usr/bin/env bash
# Build script used by Render / Railway / Heroku-style deployments.
set -o errexit

pip install --upgrade pip
pip install -r requirements.txt

python manage.py collectstatic --no-input
python manage.py migrate --no-input
