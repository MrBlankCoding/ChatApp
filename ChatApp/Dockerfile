# Use an official Python runtime as the base image
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container
COPY requirements.txt .

# Install the required packages
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 5000

# Define the command to run the app
CMD ["python", "app.py"]

#docker build -t chat-app .
#docker run -p 5000:5000 chat-app
#docker tag chat-app mrblankcoding/chat-app:the-chat-app1
#docker push mrblankcoding/chat-app:the-chat-app1
