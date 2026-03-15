#!/bin/bash

PROJECT="helper-489113"
REGION="europe-west1"
IMAGE_NAME="task-agent"
REPO="cloud-run-source-deploy"
FULL_IMAGE="europe-west1-docker.pkg.dev/$PROJECT/$REPO/$IMAGE_NAME"

docker build -t $FULL_IMAGE .

docker push $FULL_IMAGE

# Deploy the image to Cloud Run

gcloud run deploy $IMAGE_NAME \
  --image $FULL_IMAGE \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated

