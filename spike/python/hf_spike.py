"""Spike: create permission-alluring/lgu-lights-spike (public dataset), upload/delete a test PMTiles. Token from HF_TOKEN.
   python hf_spike.py upload <local> <path_in_repo> | delete <path_in_repo> | ls"""
import os, sys
from huggingface_hub import HfApi
api = HfApi(token=os.environ["HF_TOKEN"])
repo = "permission-alluring/lgu-lights-spike"
cmd = sys.argv[1]
if cmd == "upload":
    api.create_repo(repo, repo_type="dataset", private=False, exist_ok=True)
    info = api.upload_file(path_or_fileobj=sys.argv[2], path_in_repo=sys.argv[3], repo_id=repo, repo_type="dataset",
                           commit_message="Spike: temporary range-request test file (to be deleted)")
    print(info)
elif cmd == "delete":
    api.delete_file(sys.argv[2], repo_id=repo, repo_type="dataset", commit_message="Spike: remove temporary test file")
    print("deleted", sys.argv[2])
print([f for f in api.list_repo_files(repo, repo_type="dataset")])
