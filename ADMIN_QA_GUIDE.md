# Admin Guide for Q&A System

## How the New Q&A System Works

### For Users:
1. **Submit Questions**: Users fill out the form with their name, email, and question
2. **Questions Appear**: Their question immediately appears on the Q&A page
3. **1 Week Visibility**: Questions stay visible for exactly 1 week
4. **Email Notification**: When you reply, they get notified (if you set up email)

### For You (Admin):

#### Viewing Questions:
1. **Regular View**: Visit `qa.html` to see all questions
2. **Admin Mode**: Visit `qa.html#admin` to see reply options
3. **Question Status**: 
   - 🟡 **Pending** (yellow badge) = needs your reply
   - 🟢 **Answered** (green badge) = you've replied

#### Replying to Questions:
1. **Go to Admin Mode**: Add `#admin` to the URL: `yoursite.com/qa.html#admin`
2. **See Reply Boxes**: Each unanswered question will show a reply textarea
3. **Type Reply**: Write your answer in the text box
4. **Click "Send Reply"**: Reply is saved and displayed
5. **User Sees Reply**: Their question now shows your answer

#### Managing Questions:
- **Auto-Cleanup**: Questions older than 1 week automatically disappear
- **Export Data**: Click "Export Questions" to download all questions as JSON
- **No Database Needed**: Everything stored in browser localStorage

## Email Integration (Optional):
To send email notifications when you reply:
1. Keep the Formspree contact form for direct contact
2. Copy user's email from their question
3. Reply manually via your Gmail: almighty33one@gmail.com

## Admin URLs:
- **View Questions**: `yoursite.com/qa.html`
- **Admin Mode**: `yoursite.com/qa.html#admin`
- **Regular Mode**: `yoursite.com/qa.html#` (removes admin view)

## Benefits:
✅ **No Email Dependencies** - Works even if Formspree fails
✅ **Immediate Visibility** - Questions appear instantly
✅ **1 Week Auto-Cleanup** - Old questions automatically disappear
✅ **User Engagement** - People can see others' questions
✅ **Easy Management** - Simple admin interface
✅ **Backup Available** - Export questions anytime

## Example Workflow:
1. User asks: "How do I play Anna Pesaha Thirunalil?"
2. Question appears on qa.html immediately
3. You visit qa.html#admin
4. You reply: "Here's the chord progression: C-Am-F-G..."
5. User sees your reply on the website
6. After 1 week, question automatically disappears

## Mobile Friendly:
The system works perfectly on mobile devices, so you can reply to questions from your phone!
